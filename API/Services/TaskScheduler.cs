﻿using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using API.Data;
using API.Entities.Enums;
using API.Helpers.Converters;
using API.Services.Tasks;
using API.Services.Tasks.Metadata;
using API.Services.Tasks.Scanner;
using Hangfire;
using Microsoft.Extensions.Logging;

namespace API.Services;

public interface ITaskScheduler
{
    Task ScheduleTasks();
    Task ScheduleStatsTasks();
    void ScheduleUpdaterTasks();
    void ScanFolder(string folderPath);
    void ScanLibrary(int libraryId, bool force = false);
    void CleanupChapters(int[] chapterIds);
    void RefreshMetadata(int libraryId, bool forceUpdate = true);
    void RefreshSeriesMetadata(int libraryId, int seriesId, bool forceUpdate = false);
    void ScanSeries(int libraryId, int seriesId, bool forceUpdate = false);
    void AnalyzeFilesForSeries(int libraryId, int seriesId, bool forceUpdate = false);
    void AnalyzeFilesForLibrary(int libraryId, bool forceUpdate = false);
    void CancelStatsTasks();
    Task RunStatCollection();
    void ScanSiteThemes();
}
public class TaskScheduler : ITaskScheduler
{
    private readonly ICacheService _cacheService;
    private readonly ILogger<TaskScheduler> _logger;
    private readonly IScannerService _scannerService;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IMetadataService _metadataService;
    private readonly IBackupService _backupService;
    private readonly ICleanupService _cleanupService;

    private readonly IStatsService _statsService;
    private readonly IVersionUpdaterService _versionUpdaterService;
    private readonly IThemeService _themeService;
    private readonly IWordCountAnalyzerService _wordCountAnalyzerService;

    public static BackgroundJobServer Client => new BackgroundJobServer();
    public const string ScanQueue = "scan";
    public const string DefaultQueue = "default";

    public static readonly IList<string> ScanTasks = new List<string>()
        {"ScannerService", "ScanLibrary", "ScanLibraries", "ScanFolder", "ScanSeries"};

    private static readonly Random Rnd = new Random();


    public TaskScheduler(ICacheService cacheService, ILogger<TaskScheduler> logger, IScannerService scannerService,
        IUnitOfWork unitOfWork, IMetadataService metadataService, IBackupService backupService,
        ICleanupService cleanupService, IStatsService statsService, IVersionUpdaterService versionUpdaterService,
        IThemeService themeService, IWordCountAnalyzerService wordCountAnalyzerService)
    {
        _cacheService = cacheService;
        _logger = logger;
        _scannerService = scannerService;
        _unitOfWork = unitOfWork;
        _metadataService = metadataService;
        _backupService = backupService;
        _cleanupService = cleanupService;
        _statsService = statsService;
        _versionUpdaterService = versionUpdaterService;
        _themeService = themeService;
        _wordCountAnalyzerService = wordCountAnalyzerService;
    }

    public async Task ScheduleTasks()
    {
        _logger.LogInformation("Scheduling reoccurring tasks");

        var setting = (await _unitOfWork.SettingsRepository.GetSettingAsync(ServerSettingKey.TaskScan)).Value;
        if (setting != null)
        {
            var scanLibrarySetting = setting;
            _logger.LogDebug("Scheduling Scan Library Task for {Setting}", scanLibrarySetting);
            RecurringJob.AddOrUpdate("scan-libraries", () => _scannerService.ScanLibraries(),
                () => CronConverter.ConvertToCronNotation(scanLibrarySetting), TimeZoneInfo.Local);
        }
        else
        {
            RecurringJob.AddOrUpdate("scan-libraries", () => ScanLibraries(), Cron.Daily, TimeZoneInfo.Local);
        }

        setting = (await _unitOfWork.SettingsRepository.GetSettingAsync(ServerSettingKey.TaskBackup)).Value;
        if (setting != null)
        {
            _logger.LogDebug("Scheduling Backup Task for {Setting}", setting);
            RecurringJob.AddOrUpdate("backup", () => _backupService.BackupDatabase(), () => CronConverter.ConvertToCronNotation(setting), TimeZoneInfo.Local);
        }
        else
        {
            RecurringJob.AddOrUpdate("backup", () => _backupService.BackupDatabase(), Cron.Weekly, TimeZoneInfo.Local);
        }

        RecurringJob.AddOrUpdate("cleanup", () => _cleanupService.Cleanup(), Cron.Daily, TimeZoneInfo.Local);
        RecurringJob.AddOrUpdate("cleanup-db", () => _cleanupService.CleanupDbEntries(), Cron.Daily, TimeZoneInfo.Local);
    }

    #region StatsTasks


    public async Task ScheduleStatsTasks()
    {
        var allowStatCollection  = (await _unitOfWork.SettingsRepository.GetSettingsDtoAsync()).AllowStatCollection;
        if (!allowStatCollection)
        {
            _logger.LogDebug("User has opted out of stat collection, not registering tasks");
            return;
        }

        _logger.LogDebug("Scheduling stat collection daily");
        RecurringJob.AddOrUpdate("report-stats", () => _statsService.Send(), Cron.Daily(Rnd.Next(0, 22)), TimeZoneInfo.Local);
    }

    public void AnalyzeFilesForLibrary(int libraryId, bool forceUpdate = false)
    {
        BackgroundJob.Enqueue(() => _wordCountAnalyzerService.ScanLibrary(libraryId, forceUpdate));
    }

    public void CancelStatsTasks()
    {
        _logger.LogDebug("Cancelling/Removing StatsTasks");

        RecurringJob.RemoveIfExists("report-stats");
    }

    /// <summary>
    /// First time run stat collection. Executes immediately on a background thread. Does not block.
    /// </summary>
    public async Task RunStatCollection()
    {
        var allowStatCollection  = (await _unitOfWork.SettingsRepository.GetSettingsDtoAsync()).AllowStatCollection;
        if (!allowStatCollection)
        {
            _logger.LogDebug("User has opted out of stat collection, not sending stats");
            return;
        }
        BackgroundJob.Enqueue(() => _statsService.Send());
    }

    public void ScanSiteThemes()
    {
        _logger.LogInformation("Starting Site Theme scan");
        BackgroundJob.Enqueue(() => _themeService.Scan());
    }


    #endregion

    #region UpdateTasks

    public void ScheduleUpdaterTasks()
    {
        _logger.LogInformation("Scheduling Auto-Update tasks");
        // Schedule update check between noon and 6pm local time
        RecurringJob.AddOrUpdate("check-updates", () => CheckForUpdate(), Cron.Daily(Rnd.Next(12, 18)), TimeZoneInfo.Local);
    }

    public void ScanFolder(string folderPath)
    {
        _scannerService.ScanFolder(Tasks.Scanner.Parser.Parser.NormalizePath(folderPath));
    }

    #endregion

    public void ScanLibraries()
    {
        if (RunningAnyTasksByMethod(ScanTasks, ScanQueue))
        {
            _logger.LogInformation("A Scan is already running, rescheduling ScanLibraries in 3 hours");
            BackgroundJob.Schedule(() => ScanLibraries(), TimeSpan.FromHours(3));
            return;
        }
        _scannerService.ScanLibraries();
    }

    public void ScanLibrary(int libraryId, bool force = false)
    {
        var alreadyEnqueued =
            HasAlreadyEnqueuedTask("ScannerService", "ScanLibrary", new object[] {libraryId, true}, ScanQueue) ||
            HasAlreadyEnqueuedTask("ScannerService", "ScanLibrary", new object[] {libraryId, false}, ScanQueue);
        if (alreadyEnqueued)
        {
            _logger.LogInformation("A duplicate request to scan library for library occured. Skipping");
            return;
        }
        if (RunningAnyTasksByMethod(ScanTasks, ScanQueue))
        {
            _logger.LogInformation("A Scan is already running, rescheduling ScanLibrary in 3 hours");
            BackgroundJob.Schedule(() => ScanLibrary(libraryId, force), TimeSpan.FromHours(3));
            return;
        }

        _logger.LogInformation("Enqueuing library scan for: {LibraryId}", libraryId);
        BackgroundJob.Enqueue(() => _scannerService.ScanLibrary(libraryId, force));
        // When we do a scan, force cache to re-unpack in case page numbers change
        BackgroundJob.Enqueue(() => _cleanupService.CleanupCacheDirectory());
    }

    public void CleanupChapters(int[] chapterIds)
    {
        BackgroundJob.Enqueue(() => _cacheService.CleanupChapters(chapterIds));
    }

    public void RefreshMetadata(int libraryId, bool forceUpdate = true)
    {
        var alreadyEnqueued = HasAlreadyEnqueuedTask(MetadataService.Name, "GenerateCoversForLibrary",
                                  new object[] {libraryId, true}) ||
                              HasAlreadyEnqueuedTask("MetadataService", "GenerateCoversForLibrary",
                                  new object[] {libraryId, false});
        if (alreadyEnqueued)
        {
            _logger.LogInformation("A duplicate request to refresh metadata for library occured. Skipping");
            return;
        }

        _logger.LogInformation("Enqueuing library metadata refresh for: {LibraryId}", libraryId);
        BackgroundJob.Enqueue(() => _metadataService.GenerateCoversForLibrary(libraryId, forceUpdate));
    }

    public void RefreshSeriesMetadata(int libraryId, int seriesId, bool forceUpdate = false)
    {
        if (HasAlreadyEnqueuedTask(MetadataService.Name,"GenerateCoversForSeries",  new object[] {libraryId, seriesId, forceUpdate}))
        {
            _logger.LogInformation("A duplicate request to refresh metadata for library occured. Skipping");
            return;
        }

        _logger.LogInformation("Enqueuing series metadata refresh for: {SeriesId}", seriesId);
        BackgroundJob.Enqueue(() => _metadataService.GenerateCoversForSeries(libraryId, seriesId, forceUpdate));
    }

    public void ScanSeries(int libraryId, int seriesId, bool forceUpdate = false)
    {
        if (HasAlreadyEnqueuedTask(ScannerService.Name, "ScanSeries", new object[] {seriesId, forceUpdate}, ScanQueue))
        {
            _logger.LogInformation("A duplicate request to scan series occured. Skipping");
            return;
        }
        if (RunningAnyTasksByMethod(ScanTasks, ScanQueue))
        {
            _logger.LogInformation("A Scan is already running, rescheduling ScanSeries in 10 minutes");
            BackgroundJob.Schedule(() => ScanSeries(libraryId, seriesId, forceUpdate), TimeSpan.FromMinutes(10));
            return;
        }

        _logger.LogInformation("Enqueuing series scan for: {SeriesId}", seriesId);
        BackgroundJob.Enqueue(() => _scannerService.ScanSeries(seriesId, forceUpdate));
    }

    public void AnalyzeFilesForSeries(int libraryId, int seriesId, bool forceUpdate = false)
    {
        if (HasAlreadyEnqueuedTask("WordCountAnalyzerService", "ScanSeries", new object[] {libraryId, seriesId, forceUpdate}))
        {
            _logger.LogInformation("A duplicate request to scan series occured. Skipping");
            return;
        }

        _logger.LogInformation("Enqueuing analyze files scan for: {SeriesId}", seriesId);
        BackgroundJob.Enqueue(() => _wordCountAnalyzerService.ScanSeries(libraryId, seriesId, forceUpdate));
    }

    public void BackupDatabase()
    {
        BackgroundJob.Enqueue(() => _backupService.BackupDatabase());
    }

    /// <summary>
    /// Not an external call. Only public so that we can call this for a Task
    /// </summary>
    // ReSharper disable once MemberCanBePrivate.Global
    public async Task CheckForUpdate()
    {
        var update = await _versionUpdaterService.CheckForUpdate();
        await _versionUpdaterService.PushUpdate(update);
    }

    public static bool HasScanTaskRunningForLibrary(int libraryId)
    {
        return
            HasAlreadyEnqueuedTask("ScannerService", "ScanLibrary", new object[] {libraryId, true}, ScanQueue) ||
            HasAlreadyEnqueuedTask("ScannerService", "ScanLibrary", new object[] {libraryId, false}, ScanQueue);
    }

    /// <summary>
    /// Checks if this same invocation is already enqueued
    /// </summary>
    /// <param name="methodName">Method name that was enqueued</param>
    /// <param name="className">Class name the method resides on</param>
    /// <param name="args">object[] of arguments in the order they are passed to enqueued job</param>
    /// <param name="queue">Queue to check against. Defaults to "default"</param>
    /// <returns></returns>
    public static bool HasAlreadyEnqueuedTask(string className, string methodName, object[] args, string queue = DefaultQueue)
    {
        var enqueuedJobs =  JobStorage.Current.GetMonitoringApi().EnqueuedJobs(queue, 0, int.MaxValue);
        return enqueuedJobs.Any(j => j.Value.InEnqueuedState &&
                                     j.Value.Job.Method.DeclaringType != null && j.Value.Job.Args.SequenceEqual(args) &&
                                     j.Value.Job.Method.Name.Equals(methodName) &&
                                     j.Value.Job.Method.DeclaringType.Name.Equals(className));
    }

    public static bool RunningAnyTasksByMethod(IEnumerable<string> classNames, string queue = DefaultQueue)
    {
        var enqueuedJobs =  JobStorage.Current.GetMonitoringApi().EnqueuedJobs(queue, 0, int.MaxValue);
        return enqueuedJobs.Any(j => !j.Value.InEnqueuedState &&
                                     classNames.Contains(j.Value.Job.Method.DeclaringType?.Name));
    }
}

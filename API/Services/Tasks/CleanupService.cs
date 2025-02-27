﻿using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using API.Data;
using API.Entities.Enums;
using API.SignalR;
using Hangfire;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;

namespace API.Services.Tasks
{
    public interface ICleanupService
    {
        Task Cleanup();
        Task CleanupDbEntries();
        void CleanupCacheDirectory();
        Task DeleteSeriesCoverImages();
        Task DeleteChapterCoverImages();
        Task DeleteTagCoverImages();
        Task CleanupBackups();
        void CleanupTemp();
    }
    /// <summary>
    /// Cleans up after operations on reoccurring basis
    /// </summary>
    public class CleanupService : ICleanupService
    {
        private readonly ILogger<CleanupService> _logger;
        private readonly IUnitOfWork _unitOfWork;
        private readonly IEventHub _eventHub;
        private readonly IDirectoryService _directoryService;

        public CleanupService(ILogger<CleanupService> logger,
            IUnitOfWork unitOfWork, IEventHub eventHub,
            IDirectoryService directoryService)
        {
            _logger = logger;
            _unitOfWork = unitOfWork;
            _eventHub = eventHub;
            _directoryService = directoryService;
        }


        /// <summary>
        /// Cleans up Temp, cache, deleted cover images,  and old database backups
        /// </summary>
        [AutomaticRetry(Attempts = 3, LogEvents = false, OnAttemptsExceeded = AttemptsExceededAction.Fail)]
        public async Task Cleanup()
        {
            _logger.LogInformation("Starting Cleanup");
            await SendProgress(0F, "Starting cleanup");
            _logger.LogInformation("Cleaning temp directory");
            _directoryService.ClearDirectory(_directoryService.TempDirectory);
            await SendProgress(0.1F, "Cleaning temp directory");
            CleanupCacheDirectory();
            await SendProgress(0.25F, "Cleaning old database backups");
            _logger.LogInformation("Cleaning old database backups");
            await CleanupBackups();
            await SendProgress(0.50F, "Cleaning deleted cover images");
            _logger.LogInformation("Cleaning deleted cover images");
            await DeleteSeriesCoverImages();
            await SendProgress(0.6F, "Cleaning deleted cover images");
            await DeleteChapterCoverImages();
            await SendProgress(0.7F, "Cleaning deleted cover images");
            await DeleteTagCoverImages();
            await DeleteReadingListCoverImages();
            await SendProgress(1F, "Cleanup finished");
            _logger.LogInformation("Cleanup finished");
        }

        /// <summary>
        /// Cleans up abandon rows in the DB
        /// </summary>
        public async Task CleanupDbEntries()
        {
            await _unitOfWork.AppUserProgressRepository.CleanupAbandonedChapters();
            await _unitOfWork.PersonRepository.RemoveAllPeopleNoLongerAssociated();
            await _unitOfWork.GenreRepository.RemoveAllGenreNoLongerAssociated();
            await _unitOfWork.CollectionTagRepository.RemoveTagsWithoutSeries();
        }

        private async Task SendProgress(float progress, string subtitle)
        {
            await _eventHub.SendMessageAsync(MessageFactory.NotificationProgress,
                MessageFactory.CleanupProgressEvent(progress, subtitle));
        }

        /// <summary>
        /// Removes all series images that are not in the database. They must follow <see cref="ImageService.SeriesCoverImageRegex"/> filename pattern.
        /// </summary>
        public async Task DeleteSeriesCoverImages()
        {
            var images = await _unitOfWork.SeriesRepository.GetAllCoverImagesAsync();
            var files = _directoryService.GetFiles(_directoryService.CoverImageDirectory, ImageService.SeriesCoverImageRegex);
            _directoryService.DeleteFiles(files.Where(file => !images.Contains(_directoryService.FileSystem.Path.GetFileName(file))));
        }

        /// <summary>
        /// Removes all chapter/volume images that are not in the database. They must follow <see cref="ImageService.ChapterCoverImageRegex"/> filename pattern.
        /// </summary>
        public async Task DeleteChapterCoverImages()
        {
            var images = await _unitOfWork.ChapterRepository.GetAllCoverImagesAsync();
            var files = _directoryService.GetFiles(_directoryService.CoverImageDirectory, ImageService.ChapterCoverImageRegex);
            _directoryService.DeleteFiles(files.Where(file => !images.Contains(_directoryService.FileSystem.Path.GetFileName(file))));
        }

        /// <summary>
        /// Removes all collection tag images that are not in the database. They must follow <see cref="ImageService.CollectionTagCoverImageRegex"/> filename pattern.
        /// </summary>
        public async Task DeleteTagCoverImages()
        {
            var images = await _unitOfWork.CollectionTagRepository.GetAllCoverImagesAsync();
            var files = _directoryService.GetFiles(_directoryService.CoverImageDirectory, ImageService.CollectionTagCoverImageRegex);
            _directoryService.DeleteFiles(files.Where(file => !images.Contains(_directoryService.FileSystem.Path.GetFileName(file))));
        }

        /// <summary>
        /// Removes all reading list images that are not in the database. They must follow <see cref="ImageService.ReadingListCoverImageRegex"/> filename pattern.
        /// </summary>
        public async Task DeleteReadingListCoverImages()
        {
            var images = await _unitOfWork.ReadingListRepository.GetAllCoverImagesAsync();
            var files = _directoryService.GetFiles(_directoryService.CoverImageDirectory, ImageService.ReadingListCoverImageRegex);
            _directoryService.DeleteFiles(files.Where(file => !images.Contains(_directoryService.FileSystem.Path.GetFileName(file))));
        }

        /// <summary>
        /// Removes all files and directories in the cache and temp directory
        /// </summary>
        public void CleanupCacheDirectory()
        {
            _logger.LogInformation("Performing cleanup of Cache directory");
            _directoryService.ExistOrCreate(_directoryService.CacheDirectory);
            _directoryService.ExistOrCreate(_directoryService.TempDirectory);

            try
            {
                _directoryService.ClearDirectory(_directoryService.CacheDirectory);
                _directoryService.ClearDirectory(_directoryService.TempDirectory);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "There was an issue deleting one or more folders/files during cleanup");
            }

            _logger.LogInformation("Cache directory purged");
        }

        /// <summary>
        /// Removes Database backups older than configured total backups. If all backups are older than total backups days, only the latest is kept.
        /// </summary>
        public async Task CleanupBackups()
        {
            var dayThreshold = (await _unitOfWork.SettingsRepository.GetSettingsDtoAsync()).TotalBackups;
            _logger.LogInformation("Beginning cleanup of Database backups at {Time}", DateTime.Now);
            var backupDirectory =
                (await _unitOfWork.SettingsRepository.GetSettingAsync(ServerSettingKey.BackupDirectory)).Value;
            if (!_directoryService.Exists(backupDirectory)) return;

            var deltaTime = DateTime.Today.Subtract(TimeSpan.FromDays(dayThreshold));
            var allBackups = _directoryService.GetFiles(backupDirectory).ToList();
            var expiredBackups = allBackups.Select(filename => _directoryService.FileSystem.FileInfo.FromFileName(filename))
                .Where(f => f.CreationTime < deltaTime)
                .ToList();

            if (expiredBackups.Count == allBackups.Count)
            {
                _logger.LogInformation("All expired backups are older than {Threshold} days. Removing all but last backup", dayThreshold);
                var toDelete = expiredBackups.OrderByDescending(f => f.CreationTime).ToList();
                _directoryService.DeleteFiles(toDelete.Take(toDelete.Count - 1).Select(f => f.FullName));
            }
            else
            {
                _directoryService.DeleteFiles(expiredBackups.Select(f => f.FullName));
            }
            _logger.LogInformation("Finished cleanup of Database backups at {Time}", DateTime.Now);
        }

        public void CleanupTemp()
        {
            _logger.LogInformation("Performing cleanup of Temp directory");
            _directoryService.ExistOrCreate(_directoryService.TempDirectory);

            try
            {
                _directoryService.ClearDirectory(_directoryService.TempDirectory);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "There was an issue deleting one or more folders/files during cleanup");
            }

            _logger.LogInformation("Temp directory purged");
        }
    }
}

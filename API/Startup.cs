using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Threading.Tasks;
using API.Constants;
using API.Data;
using API.Entities;
using API.Entities.Enums;
using API.Extensions;
using API.Middleware;
using API.Services;
using API.Services.HostedServices;
using API.Services.Tasks;
using API.SignalR;
using Hangfire;
using Hangfire.MemoryStorage;
using Hangfire.Storage.SQLite;
using Kavita.Common;
using Kavita.Common.EnvironmentInfo;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;
using Microsoft.OpenApi.Models;
using TaskScheduler = API.Services.TaskScheduler;

namespace API
{
    public class Startup
    {
        private readonly IConfiguration _config;
        private readonly IWebHostEnvironment _env;

        public Startup(IConfiguration config, IWebHostEnvironment env)
        {
            _config = config;
            _env = env;
        }

        // This method gets called by the runtime. Use this method to add services to the container.
        public void ConfigureServices(IServiceCollection services)
        {
            services.AddApplicationServices(_config, _env);
            services.AddControllers(options =>
            {
                options.CacheProfiles.Add("Images",
                    new CacheProfile()
                    {
                        Duration = 60,
                        Location = ResponseCacheLocation.None,
                        NoStore = false
                    });
                options.CacheProfiles.Add("Hour",
                    new CacheProfile()
                    {
                        Duration = 60 * 10,
                        Location = ResponseCacheLocation.None,
                        NoStore = false
                    });
            });
            services.Configure<ForwardedHeadersOptions>(options =>
            {
                options.ForwardedHeaders = ForwardedHeaders.All;
                foreach(var proxy in _config.GetSection("KnownProxies").AsEnumerable().Where(c => c.Value != null)) {
                    options.KnownProxies.Add(IPAddress.Parse(proxy.Value));
                }
            });
            services.AddCors();
            services.AddIdentityServices(_config);
            services.AddSwaggerGen(c =>
            {
                c.SwaggerDoc("v1", new OpenApiInfo()
                {
                    Description = "Kavita provides a set of APIs that are authenticated by JWT. JWT token can be copied from local storage.",
                    Title = "Kavita API",
                    Version = "v1",
                });


                var filePath = Path.Combine(AppContext.BaseDirectory, "API.xml");
                c.IncludeXmlComments(filePath, true);
                c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme {
                    In = ParameterLocation.Header,
                    Description = "Please insert JWT with Bearer into field",
                    Name = "Authorization",
                    Type = SecuritySchemeType.ApiKey
                });
                c.AddSecurityRequirement(new OpenApiSecurityRequirement {
                    {
                        new OpenApiSecurityScheme
                        {
                            Reference = new OpenApiReference
                            {
                                Type = ReferenceType.SecurityScheme,
                                Id = "Bearer"
                            }
                        },
                        Array.Empty<string>()
                    }
                });

                c.AddServer(new OpenApiServer()
                {
                    Description = "Custom Url",
                    Url = "/"
                });

                c.AddServer(new OpenApiServer()
                {
                    Description = "Local Server",
                    Url = "http://localhost:5000/",
                });

                c.AddServer(new OpenApiServer()
                {
                    Url = "https://demo.kavitareader.com/",
                    Description = "Kavita Demo"
                });

                c.AddServer(new OpenApiServer()
                {
                    Url = "http://" + GetLocalIpAddress() + ":5000/",
                    Description = "Local IP"
                });

            });
            services.AddResponseCompression(options =>
            {
                options.Providers.Add<BrotliCompressionProvider>();
                options.Providers.Add<GzipCompressionProvider>();
                options.MimeTypes =
                    ResponseCompressionDefaults.MimeTypes.Concat(
                        new[] { "image/jpeg", "image/jpg" });
                options.EnableForHttps = true;
            });
            services.Configure<BrotliCompressionProviderOptions>(options =>
            {
                options.Level = CompressionLevel.Fastest;
            });

            services.AddResponseCaching();

            services.AddHangfire(configuration => configuration
                .UseSimpleAssemblyNameTypeSerializer()
                .UseRecommendedSerializerSettings()
                .UseMemoryStorage()); // UseSQLiteStorage - SQLite has some issues around resuming jobs when aborted

            // Add the processing server as IHostedService
            services.AddHangfireServer(options =>
            {
                options.Queues = new[] {TaskScheduler.ScanQueue, TaskScheduler.DefaultQueue};
            });
            // Add IHostedService for startup tasks
            // Any services that should be bootstrapped go here
            services.AddHostedService<StartupTasksHostedService>();
        }

        // This method gets called by the runtime. Use this method to configure the HTTP request pipeline.
        public void Configure(IApplicationBuilder app, IBackgroundJobClient backgroundJobs, IWebHostEnvironment env,
            IHostApplicationLifetime applicationLifetime, IServiceProvider serviceProvider, ICacheService cacheService,
            IDirectoryService directoryService, IUnitOfWork unitOfWork, IBackupService backupService, IImageService imageService)
        {

            // Apply Migrations
            try
            {
                Task.Run(async () =>
                {
                    // Apply all migrations on startup
                    var logger = serviceProvider.GetRequiredService<ILogger<Program>>();
                    var userManager = serviceProvider.GetRequiredService<UserManager<AppUser>>();
                    var themeService = serviceProvider.GetRequiredService<IThemeService>();
                    var dataContext = serviceProvider.GetRequiredService<DataContext>();


                    // Only run this if we are upgrading
                    await MigrateChangePasswordRoles.Migrate(unitOfWork, userManager);

                    await MigrateRemoveExtraThemes.Migrate(unitOfWork, themeService);

                    // Only needed for v0.5.5.x and v0.5.6
                    await MigrateNormalizedLocalizedName.Migrate(unitOfWork, dataContext, logger);

                    //  Update the version in the DB after all migrations are run
                    var installVersion = await unitOfWork.SettingsRepository.GetSettingAsync(ServerSettingKey.InstallVersion);
                    installVersion.Value = BuildInfo.Version.ToString();
                    unitOfWork.SettingsRepository.Update(installVersion);

                    await unitOfWork.CommitAsync();
                }).GetAwaiter()
                    .GetResult();
            }
            catch (Exception ex)
            {
                var logger = serviceProvider.GetRequiredService<ILogger<Program>>();
                logger.LogCritical(ex, "An error occurred during migration");
            }



            app.UseMiddleware<ExceptionMiddleware>();

            Task.Run(async () =>
            {
                var allowSwaggerUi = (await unitOfWork.SettingsRepository.GetSettingsDtoAsync())
                    .EnableSwaggerUi;

                if (env.IsDevelopment() || allowSwaggerUi)
                {
                    app.UseSwagger();
                    app.UseSwaggerUI(c =>
                    {
                        c.SwaggerEndpoint("/swagger/v1/swagger.json", "Kavita API " + BuildInfo.Version);
                    });
                }
            });

            if (env.IsDevelopment())
            {
                app.UseHangfireDashboard();
            }

            app.UseResponseCompression();

            app.UseForwardedHeaders();

            app.UseRouting();

            // Ordering is important. Cors, authentication, authorization
            if (env.IsDevelopment())
            {
                app.UseCors(policy => policy
                    .AllowAnyHeader()
                    .AllowAnyMethod()
                    .AllowCredentials() // For SignalR token query param
                    .WithOrigins("http://localhost:4200", $"http://{GetLocalIpAddress()}:4200")
                    .WithExposedHeaders("Content-Disposition", "Pagination"));
            }

            app.UseResponseCaching();

            app.UseAuthentication();

            app.UseAuthorization();

            app.UseDefaultFiles();

            app.UseStaticFiles(new StaticFileOptions
            {
                ContentTypeProvider = new FileExtensionContentTypeProvider(),
                HttpsCompression = HttpsCompressionMode.Compress,
                OnPrepareResponse = ctx =>
                {
                    const int durationInSeconds = 60 * 60 * 24;
                    ctx.Context.Response.Headers[HeaderNames.CacheControl] = "public,max-age=" + durationInSeconds;
                }
            });

            app.Use(async (context, next) =>
            {
                // Note: I removed this as I caught Chrome caching api responses when it shouldn't have
                // context.Response.GetTypedHeaders().CacheControl =
                //     new CacheControlHeaderValue()
                //     {
                //         Public = false,
                //         MaxAge = TimeSpan.FromSeconds(10),
                //     };
                context.Response.Headers[HeaderNames.Vary] =
                    new[] { "Accept-Encoding" };

                // Don't let the site be iframed outside the same origin (clickjacking)
                context.Response.Headers.XFrameOptions = "SAMEORIGIN";

                // Setup CSP to ensure we load assets only from these origins
                context.Response.Headers.Add("Content-Security-Policy", "frame-ancestors 'none';");

                await next();
            });

            app.UseEndpoints(endpoints =>
            {
                endpoints.MapControllers();
                endpoints.MapHub<MessageHub>("hubs/messages");
                endpoints.MapHangfireDashboard();
                endpoints.MapFallbackToController("Index", "Fallback");
            });

            applicationLifetime.ApplicationStopping.Register(OnShutdown);
            applicationLifetime.ApplicationStarted.Register(() =>
            {
                try
                {
                    var logger = serviceProvider.GetRequiredService<ILogger<Startup>>();
                    logger.LogInformation("Kavita - v{Version}", BuildInfo.Version);
                }
                catch (Exception)
                {
                    /* Swallow Exception */
                }
                Console.WriteLine($"Kavita - v{BuildInfo.Version}");
            });
        }

        private static void OnShutdown()
        {
            Console.WriteLine("Server is shutting down. Please allow a few seconds to stop any background jobs...");
            TaskScheduler.Client.Dispose();
            System.Threading.Thread.Sleep(1000);
            Console.WriteLine("You may now close the application window.");
        }

        private static string GetLocalIpAddress()
        {
            using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, 0);
            socket.Connect("8.8.8.8", 65530);
            if (socket.LocalEndPoint is IPEndPoint endPoint) return endPoint.Address.ToString();
            throw new KavitaException("No network adapters with an IPv4 address in the system!");
        }

    }
}

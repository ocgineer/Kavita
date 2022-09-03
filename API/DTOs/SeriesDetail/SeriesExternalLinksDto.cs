using System.Collections.Generic;
using API.Entities.Enums;

namespace API.DTOs.SeriesDetail;

public class SeriesExternalLinksDto
{
    public IEnumerable<string> OtherWebsite { get; set; }
    public IEnumerable<string> AniList { get; set; }
    public IEnumerable<string> MangaUpdates { get; set; }
    public IEnumerable<string> MyAnimeList { get; set; }
    public IEnumerable<string> Goodreads { get; set; }
}

using System.Collections.Generic;

namespace API.DTOs.SeriesDetail;

public class UpdateSeriesExternalLinksDto
{
    public IList<string> OtherWebsite { get; set; }
    public IList<string> AniList { get; set; }
    public IList<string> MangaUpdates { get; set; }
    public IList<string> MyAnimeList { get; set; }
    public IList<string> Goodreads { get; set; }
}

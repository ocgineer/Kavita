export enum ExternalLinkKind {
    OtherWebsite = 1,
    Goodreads = 2,
    MyAnimeList = 3,
    AniList = 4,
    MangaUpdates = 5,
}

export const ExternalLinkKinds = [
    {text: 'Website', value: ExternalLinkKind.OtherWebsite},
    {text: 'Goodreads', value: ExternalLinkKind.Goodreads},
    {text: 'MyAnimeList', value: ExternalLinkKind.MyAnimeList},
    {text: 'AniList', value: ExternalLinkKind.AniList},
    {text: 'MangaUpdates', value: ExternalLinkKind.MangaUpdates},
];

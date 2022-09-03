export enum ExternalLinkKind {
    OtherWebsite = 1,
    AniList,
    MangaUpdates,
    MyAnimeList,
    Goodreads,
}

export const ExternalLinkKinds = [
    {text: 'Other Website', value: ExternalLinkKind.OtherWebsite},
    {text: 'AniList', value: ExternalLinkKind.AniList},
    {text: 'MangaUpdates', value: ExternalLinkKind.MangaUpdates},
    {text: 'MyAnimeList', value: ExternalLinkKind.MyAnimeList},
    {text: 'Goodreads', value: ExternalLinkKind.Goodreads},
];

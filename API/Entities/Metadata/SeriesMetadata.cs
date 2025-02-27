﻿using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using API.Entities.Enums;
using API.Entities.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace API.Entities.Metadata
{
    [Index(nameof(Id), nameof(SeriesId), IsUnique = true)]
    public class SeriesMetadata : IHasConcurrencyToken
    {
        public int Id { get; set; }

        public string Summary { get; set; } = string.Empty;

        public ICollection<CollectionTag> CollectionTags { get; set; }

        public ICollection<Genre> Genres { get; set; } = new List<Genre>();
        public ICollection<Tag> Tags { get; set; } = new List<Tag>();
        /// <summary>
        /// All people attached at a Series level.
        /// </summary>
        public ICollection<Person> People { get; set; } = new List<Person>();

        /// <summary>
        /// Highest Age Rating from all Chapters
        /// </summary>
        public AgeRating AgeRating { get; set; }
        /// <summary>
        /// Earliest Year from all chapters
        /// </summary>
        public int ReleaseYear { get; set; }
        /// <summary>
        /// Language of the content (BCP-47 code)
        /// </summary>
        public string Language { get; set; } = string.Empty;
        /// <summary>
        /// Total number of issues/volumes in the series
        /// </summary>
        public int TotalCount { get; set; } = 0;
        /// <summary>
        /// Max number of issues/volumes in the series (Max of Volume/Issue field in ComicInfo)
        /// </summary>
        public int MaxCount { get; set; } = 0;
        public PublicationStatus PublicationStatus { get; set; }

        // Locks
        public bool LanguageLocked { get; set; }
        public bool SummaryLocked { get; set; }
        /// <summary>
        /// Locked by user so metadata updates from scan loop will not override AgeRating
        /// </summary>
        public bool AgeRatingLocked { get; set; }
        /// <summary>
        /// Locked by user so metadata updates from scan loop will not override PublicationStatus
        /// </summary>
        public bool PublicationStatusLocked { get; set; }
        public bool GenresLocked { get; set; }
        public bool TagsLocked { get; set; }
        public bool WriterLocked { get; set; }
        public bool CharacterLocked { get; set; }
        public bool ColoristLocked { get; set; }
        public bool EditorLocked { get; set; }
        public bool InkerLocked { get; set; }
        public bool LettererLocked { get; set; }
        public bool PencillerLocked { get; set; }
        public bool PublisherLocked { get; set; }
        public bool TranslatorLocked { get; set; }
        public bool CoverArtistLocked { get; set; }


        // Relationship
        public Series Series { get; set; }
        public int SeriesId { get; set; }

        /// <inheritdoc />
        [ConcurrencyCheck]
        public uint RowVersion { get; private set; }


        /// <inheritdoc />
        public void OnSavingChanges()
        {
            RowVersion++;
        }
    }
}

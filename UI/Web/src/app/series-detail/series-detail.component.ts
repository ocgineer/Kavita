import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, Inject, ChangeDetectionStrategy, ChangeDetectorRef, AfterContentChecked } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { NgbModal, NgbNavChangeEvent, NgbOffcanvas } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import { forkJoin, Subject, tap } from 'rxjs';
import { take, takeUntil } from 'rxjs/operators';
import { BulkSelectionService } from '../cards/bulk-selection.service';
import { EditSeriesModalComponent } from '../cards/_modals/edit-series-modal/edit-series-modal.component';
import { ConfirmConfig } from '../shared/confirm-dialog/_models/confirm-config';
import { ConfirmService } from '../shared/confirm.service';
import { TagBadgeCursor } from '../shared/tag-badge/tag-badge.component';
import { DownloadService } from '../shared/_services/download.service';
import { KEY_CODES, UtilityService } from '../shared/_services/utility.service';
import { ReviewSeriesModalComponent } from './review-series-modal/review-series-modal.component';
import { Chapter } from '../_models/chapter';
import { ScanSeriesEvent } from '../_models/events/scan-series-event';
import { SeriesRemovedEvent } from '../_models/events/series-removed-event';
import { LibraryType } from '../_models/library';
import { MangaFormat } from '../_models/manga-format';
import { ReadingList } from '../_models/reading-list';
import { Series } from '../_models/series';
import { SeriesMetadata } from '../_models/series-metadata';
import { Volume } from '../_models/volume';
import { AccountService } from '../_services/account.service';
import { ActionItem, ActionFactoryService, Action } from '../_services/action-factory.service';
import { ActionService } from '../_services/action.service';
import { ImageService } from '../_services/image.service';
import { LibraryService } from '../_services/library.service';
import { EVENTS, MessageHubService } from '../_services/message-hub.service';
import { ReaderService } from '../_services/reader.service';
import { ReadingListService } from '../_services/reading-list.service';
import { SeriesService } from '../_services/series.service';
import { NavService } from '../_services/nav.service';
import { RelatedSeries } from '../_models/series-detail/related-series';
import { RelationKind } from '../_models/series-detail/relation-kind';
import { CardDetailDrawerComponent } from '../cards/card-detail-drawer/card-detail-drawer.component';
import { FormGroup, FormControl } from '@angular/forms';
import { PageLayoutMode } from '../_models/page-layout-mode';
import { DOCUMENT } from '@angular/common';
import { User } from '../_models/user';
import { ScrollService } from '../_services/scroll.service';

interface RelatedSeris {
  series: Series;
  relation: RelationKind;
}

enum TabID {
  Related = 0,
  Specials = 1,
  Storyline = 2,
  Volumes = 3,
  Chapters = 4
}

interface StoryLineItem {
  chapter?: Chapter;
  volume?: Volume;
  isChapter: boolean;
}

@Component({
  selector: 'app-series-detail',
  templateUrl: './series-detail.component.html',
  styleUrls: ['./series-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SeriesDetailComponent implements OnInit, OnDestroy, AfterContentChecked {

  @ViewChild('scrollingBlock') scrollingBlock: ElementRef<HTMLDivElement> | undefined;
  @ViewChild('companionBar') companionBar: ElementRef<HTMLDivElement> | undefined;

  /**
   * Series Id. Set at load before UI renders
   */
  seriesId!: number;
  series!: Series;
  volumes: Volume[] = [];
  chapters: Chapter[] = [];
  storyChapters: Chapter[] = [];
  storylineItems: StoryLineItem[] = [];
  libraryId = 0;
  isAdmin = false;
  hasDownloadingRole = false;
  isLoading = true;
  showBook = true;

  currentlyReadingChapter: Chapter | undefined = undefined;
  hasReadingProgress = false;


  seriesActions: ActionItem<Series>[] = [];
  volumeActions: ActionItem<Volume>[] = [];
  chapterActions: ActionItem<Chapter>[] = [];
  bulkActions: ActionItem<any>[] = [];

  hasSpecials = false;
  specials: Array<Chapter> = [];
  activeTabId = TabID.Storyline;
  hasNonSpecialVolumeChapters = false;
  hasNonSpecialNonVolumeChapters = false;

  userReview: string = '';
  libraryType: LibraryType = LibraryType.Manga;
  seriesMetadata: SeriesMetadata | null = null;
  readingLists: Array<ReadingList> = [];
  /**
   * Poster image for the Series
   */
  seriesImage: string = '';
  downloadInProgress: boolean = false;

  /**
   * If an action is currently being done, don't let the user kick off another action
   */
  actionInProgress: boolean = false;

  itemSize: number = 10; // when 10 done, 16 loads

  /**
   * Track by function for Volume to tell when to refresh card data
   */
  trackByVolumeIdentity = (index: number, item: Volume) => `${item.name}_${item.pagesRead}`;
  /**
   * Track by function for Chapter to tell when to refresh card data
   */
  trackByChapterIdentity = (index: number, item: Chapter) => `${item.title}_${item.number}_${item.volumeId}_${item.pagesRead}`;
  trackByRelatedSeriesIdentiy = (index: number, item: RelatedSeris) => `${item.series.name}_${item.series.libraryId}_${item.series.pagesRead}_${item.relation}`;
  trackByStoryLineIdentity = (index: number, item: StoryLineItem) => {
    if (item.isChapter) {
      return this.trackByChapterIdentity(index, item!.chapter!)
    }
    return this.trackByVolumeIdentity(index, item!.volume!);
  };

  /**
   * Are there any related series
   */
  hasRelations: boolean = false;
  /**
   * Related Series. Sorted by backend
   */
  relations: Array<RelatedSeris> = [];

  sortingOptions: Array<{value: string, text: string}> = [
    {value: 'Storyline', text: 'Storyline'},
    {value: 'Release', text: 'Release'},
    {value: 'Added', text: 'Added'},
  ];
  renderMode: PageLayoutMode = PageLayoutMode.Cards;

  pageExtrasGroup = new FormGroup({
    'sortingOption': new FormControl(this.sortingOptions[0].value, []),
    'renderMode': new FormControl(this.renderMode, []),
  });

  isAscendingSort: boolean = false; // TODO: Get this from User preferences
  user: User | undefined;

  bulkActionCallback = (action: Action, data: any) => {
    if (this.series === undefined) {
      return;
    }
    const seriesId = this.series.id;
    // we need to figure out what is actually selected now
    const selectedVolumeIndexes = this.bulkSelectionService.getSelectedCardsForSource('volume');
    const selectedChapterIndexes = this.bulkSelectionService.getSelectedCardsForSource('chapter');
    const selectedSpecialIndexes = this.bulkSelectionService.getSelectedCardsForSource('special');

    // NOTE: This needs to check current tab as chapter array will be different
    let chapterArray = this.storyChapters;
    if (this.activeTabId === TabID.Chapters) chapterArray = this.chapters;

    const selectedChapterIds = chapterArray.filter((_chapter, index: number) => selectedChapterIndexes.includes(index + ''));
    const selectedVolumeIds = this.volumes.filter((_volume, index: number) => selectedVolumeIndexes.includes(index + ''));
    const selectedSpecials = this.specials.filter((_chapter, index: number) => selectedSpecialIndexes.includes(index + ''));
    const chapters = [...selectedChapterIds, ...selectedSpecials];

    switch (action) {
      case Action.AddToReadingList:
        this.actionService.addMultipleToReadingList(seriesId, selectedVolumeIds, chapters, (success) => {
          this.actionInProgress = false;
          if (success) this.bulkSelectionService.deselectAll();
          this.changeDetectionRef.markForCheck();
        });
        break;
      case Action.MarkAsRead:
        this.actionService.markMultipleAsRead(seriesId, selectedVolumeIds, chapters,  () => {
          this.setContinuePoint();
          this.actionInProgress = false;
          this.bulkSelectionService.deselectAll();
          this.changeDetectionRef.markForCheck();
        });

        break;
      case Action.MarkAsUnread:
        this.actionService.markMultipleAsUnread(seriesId, selectedVolumeIds, chapters,  () => {
          this.setContinuePoint();
          this.actionInProgress = false;
          this.bulkSelectionService.deselectAll();
          this.changeDetectionRef.markForCheck();
        });
        break;
    }
  }

  private onDestroy: Subject<void> = new Subject();


  get LibraryType() {
    return LibraryType;
  }

  get MangaFormat() {
    return MangaFormat;
  }

  get TagBadgeCursor() {
    return TagBadgeCursor;
  }

  get TabID() {
    return TabID;
  }

  get PageLayoutMode() {
    return PageLayoutMode;
  }

  get ScrollingBlockHeight() {
    if (this.scrollingBlock === undefined) return 'calc(var(--vh)*100)';
    const navbar = this.document.querySelector('.navbar') as HTMLElement;
    if (navbar === null) return 'calc(var(--vh)*100)';

    const companionHeight = this.companionBar!.nativeElement.offsetHeight;
    const navbarHeight = navbar.offsetHeight;
    const totalHeight = companionHeight + navbarHeight + 21; //21px to account for padding
    return 'calc(var(--vh)*100 - ' + totalHeight + 'px)';
  }

  constructor(private route: ActivatedRoute, private seriesService: SeriesService,
              private router: Router, public bulkSelectionService: BulkSelectionService,
              private modalService: NgbModal, public readerService: ReaderService,
              public utilityService: UtilityService, private toastr: ToastrService,
              private accountService: AccountService, public imageService: ImageService,
              private actionFactoryService: ActionFactoryService, private libraryService: LibraryService,
              private confirmService: ConfirmService, private titleService: Title,
              private downloadService: DownloadService, private actionService: ActionService,
              public imageSerivce: ImageService, private messageHub: MessageHubService,
              private readingListService: ReadingListService, public navService: NavService,
              private offcanvasService: NgbOffcanvas, @Inject(DOCUMENT) private document: Document, 
              private changeDetectionRef: ChangeDetectorRef, private scrollService: ScrollService
              ) {
    this.router.routeReuseStrategy.shouldReuseRoute = () => false;
    this.accountService.currentUser$.pipe(take(1)).subscribe(user => {
      if (user) {
        this.user = user;
        this.isAdmin = this.accountService.hasAdminRole(user);
        this.hasDownloadingRole = this.accountService.hasDownloadRole(user);
        this.renderMode = user.preferences.globalPageLayoutMode;
        this.pageExtrasGroup.get('renderMode')?.setValue(this.renderMode);
        this.changeDetectionRef.markForCheck();
      }
    });
  }

  ngAfterContentChecked(): void {
    this.scrollService.setScrollContainer(this.scrollingBlock);
  }


  ngOnInit(): void {
    const routeId = this.route.snapshot.paramMap.get('seriesId');
    const libraryId = this.route.snapshot.paramMap.get('libraryId');
    if (routeId === null || libraryId == null) {
      this.router.navigateByUrl('/libraries');
      return;
    }

    this.messageHub.messages$.pipe(takeUntil(this.onDestroy)).subscribe(event => {
      if (event.event === EVENTS.SeriesRemoved) {
        const seriesRemovedEvent = event.payload as SeriesRemovedEvent;
        if (seriesRemovedEvent.seriesId === this.seriesId) {
          this.toastr.info('This series no longer exists');
          this.router.navigateByUrl('/libraries');
        }
      } else if (event.event === EVENTS.ScanSeries) {
        const seriesCoverUpdatedEvent = event.payload as ScanSeriesEvent;
        if (seriesCoverUpdatedEvent.seriesId === this.seriesId) {
          this.loadSeries(this.seriesId);
        }
      }
    });

    this.seriesId = parseInt(routeId, 10);
    this.libraryId = parseInt(libraryId, 10);
    this.seriesImage = this.imageService.getSeriesCoverImage(this.seriesId);
    this.changeDetectionRef.markForCheck();
    this.loadSeries(this.seriesId);

    this.pageExtrasGroup.get('renderMode')?.valueChanges.pipe(takeUntil(this.onDestroy)).subscribe((val: PageLayoutMode | null) => {
      if (val == null) return;
      this.renderMode = val;
      this.changeDetectionRef.markForCheck();
    });
  }

  ngOnDestroy() {
    this.onDestroy.next();
    this.onDestroy.complete();
  }

  @HostListener('document:keydown.shift', ['$event'])
  handleKeypress(event: KeyboardEvent) {
    if (event.key === KEY_CODES.SHIFT) {
      this.bulkSelectionService.isShiftDown = true;
    }
  }

  @HostListener('document:keyup.shift', ['$event'])
  handleKeyUp(event: KeyboardEvent) {
    if (event.key === KEY_CODES.SHIFT) {
      this.bulkSelectionService.isShiftDown = false;
    }
  }

  onNavChange(event: NgbNavChangeEvent) {
    this.bulkSelectionService.deselectAll();
    this.changeDetectionRef.markForCheck();
  }

  handleSeriesActionCallback(action: Action, series: Series) {
    this.actionInProgress = true;
    this.changeDetectionRef.markForCheck();
    switch(action) {
      case(Action.MarkAsRead):
        this.actionService.markSeriesAsRead(series, (series: Series) => {
          this.actionInProgress = false;
          this.loadSeries(series.id);
        });
        break;
      case(Action.MarkAsUnread):
        this.actionService.markSeriesAsUnread(series, (series: Series) => {
          this.actionInProgress = false;
          this.loadSeries(series.id);
        });
        break;
      case(Action.Scan):
        this.actionService.scanSeries(series, () => {
          this.actionInProgress = false;
          this.changeDetectionRef.markForCheck();
        });
        break;
      case(Action.RefreshMetadata):
        this.actionService.refreshMetdata(series, () => {
          this.actionInProgress = false;
          this.changeDetectionRef.markForCheck();
        });
        break;
      case(Action.Delete):
        this.deleteSeries(series);
        break;
      case(Action.AddToReadingList):
        this.actionService.addSeriesToReadingList(series, () => {
          this.actionInProgress = false;
          this.changeDetectionRef.markForCheck();
        });
        break;
      case(Action.AddToCollection):
        this.actionService.addMultipleSeriesToCollectionTag([series], () => {
          this.actionInProgress = false;
          this.changeDetectionRef.markForCheck();
        });
        break;
      case (Action.AnalyzeFiles):
        this.actionService.analyzeFilesForSeries(series, () => {
          this.actionInProgress = false;
          this.changeDetectionRef.markForCheck();
        });
        break;
      case Action.AddToWantToReadList:
        this.actionService.addMultipleSeriesToWantToReadList([series.id], () => {
          this.actionInProgress = false;
          this.changeDetectionRef.markForCheck();
        });
        break;
      case Action.RemoveFromWantToReadList:
        this.actionService.removeMultipleSeriesFromWantToReadList([series.id], () => {
          this.actionInProgress = false;
          this.changeDetectionRef.markForCheck();
        });
        break;
      case (Action.Download):
        if (this.downloadInProgress) return;
        this.downloadSeries();
        break;
      default:
        break;
    }
  }

  handleVolumeActionCallback(action: Action, volume: Volume) {
    switch(action) {
      case(Action.MarkAsRead):
        this.markVolumeAsRead(volume);
        break;
      case(Action.MarkAsUnread):
        this.markVolumeAsUnread(volume);
        break;
      case(Action.Edit):
        this.openViewInfo(volume);
        break;
      case(Action.AddToReadingList):
        this.actionService.addVolumeToReadingList(volume, this.seriesId, () => {/* No Operation */ });
        break;
      case(Action.IncognitoRead):
        if (volume.chapters != undefined && volume.chapters?.length >= 1) {
          this.openChapter(volume.chapters.sort(this.utilityService.sortChapters)[0], true);
        }
        break;
      default:
        break;
    }
  }

  handleChapterActionCallback(action: Action, chapter: Chapter) {
    switch (action) {
      case(Action.MarkAsRead):
        this.markChapterAsRead(chapter);
        break;
      case(Action.MarkAsUnread):
        this.markChapterAsUnread(chapter);
        break;
      case(Action.Edit):
        this.openViewInfo(chapter);
        break;
      case(Action.AddToReadingList):
        this.actionService.addChapterToReadingList(chapter, this.seriesId, () => {/* No Operation */ });
        break;
      case(Action.IncognitoRead):
        this.openChapter(chapter, true);
        break;
      default:
        break;
    }
  }


  async deleteSeries(series: Series) {
    this.actionService.deleteSeries(series, (result: boolean) => {
      this.actionInProgress = false;
      this.changeDetectionRef.markForCheck();
      if (result) {
        this.router.navigate(['library', this.libraryId]);
      }
    });
  }

  loadSeries(seriesId: number) {
    this.seriesService.getMetadata(seriesId).subscribe(metadata => {
      this.seriesMetadata = metadata;
      this.changeDetectionRef.markForCheck();
    });
    
    this.readingListService.getReadingListsForSeries(seriesId).subscribe(lists => {
      this.readingLists = lists;
      this.changeDetectionRef.markForCheck();
    });
    this.setContinuePoint();

    forkJoin({
      libType: this.libraryService.getLibraryType(this.libraryId),
      series: this.seriesService.getSeries(seriesId)
    }).subscribe(results => {
      this.libraryType = results.libType;
      this.series = results.series;

      this.createHTML();

      this.titleService.setTitle('Kavita - ' + this.series.name + ' Details');

      this.seriesActions = this.actionFactoryService.getSeriesActions(this.handleSeriesActionCallback.bind(this))
              .filter(action => action.action !== Action.Edit);
      this.seriesActions.push({action: Action.Download, callback: this.seriesActions[0].callback, requiresAdmin: false, title: 'Download'});

      this.volumeActions = this.actionFactoryService.getVolumeActions(this.handleVolumeActionCallback.bind(this));
      this.chapterActions = this.actionFactoryService.getChapterActions(this.handleChapterActionCallback.bind(this));

      this.seriesService.getRelatedForSeries(this.seriesId).subscribe((relations: RelatedSeries) => {
        this.relations = [
          ...relations.prequels.map(item => this.createRelatedSeries(item, RelationKind.Prequel)),
          ...relations.sequels.map(item => this.createRelatedSeries(item, RelationKind.Sequel)),
          ...relations.sideStories.map(item => this.createRelatedSeries(item, RelationKind.SideStory)), 
          ...relations.spinOffs.map(item => this.createRelatedSeries(item, RelationKind.SpinOff)),
          ...relations.adaptations.map(item => this.createRelatedSeries(item, RelationKind.Adaptation)),
          ...relations.contains.map(item => this.createRelatedSeries(item, RelationKind.Contains)),
          ...relations.characters.map(item => this.createRelatedSeries(item, RelationKind.Character)), 
          ...relations.others.map(item => this.createRelatedSeries(item, RelationKind.Other)),
          ...relations.alternativeSettings.map(item => this.createRelatedSeries(item, RelationKind.AlternativeSetting)),
          ...relations.alternativeVersions.map(item => this.createRelatedSeries(item, RelationKind.AlternativeVersion)),
          ...relations.doujinshis.map(item => this.createRelatedSeries(item, RelationKind.Doujinshi)),
          ...relations.parent.map(item => this.createRelatedSeries(item, RelationKind.Parent)),
        ];
        if (this.relations.length > 0) {
          this.hasRelations = true;
          this.changeDetectionRef.markForCheck();
        } else {
          this.hasRelations = false;
          this.changeDetectionRef.markForCheck();
        }
      });

      this.seriesService.getSeriesDetail(this.seriesId).subscribe(detail => {
        this.hasSpecials = detail.specials.length > 0;
        this.specials = detail.specials;

        this.chapters = detail.chapters;
        this.volumes = detail.volumes;
        this.storyChapters = detail.storylineChapters;
        this.storylineItems = [];
        const v = this.volumes.map(v => {
          return {volume: v, chapter: undefined, isChapter: false} as StoryLineItem;
        });
        this.storylineItems.push(...v);
        const c = this.storyChapters.map(c => {
          return {volume: undefined, chapter: c, isChapter: true} as StoryLineItem;
        });
        this.storylineItems.push(...c);


        this.updateSelectedTab();
        this.isLoading = false;
        this.changeDetectionRef.markForCheck();
      });
    }, err => {
      this.router.navigateByUrl('/libraries');
    });
  }

  createRelatedSeries(series: Series, relation: RelationKind) {
    return {series, relation} as RelatedSeris;
  }

  /**
   * This will update the selected tab
   *
   * This assumes loadPage() has already primed all the calculations and state variables. Do not call directly.
   */
  updateSelectedTab() {

    // Book libraries only have Volumes or Specials enabled
    if (this.libraryType === LibraryType.Book) {
      if (this.volumes.length === 0) {
        this.activeTabId = TabID.Specials;
      } else {
        this.activeTabId = TabID.Volumes;
      }
      return;
    }

    if (this.volumes.length === 0 && this.chapters.length === 0 && this.specials.length > 0) {
      this.activeTabId = TabID.Specials;
    } else {
      this.activeTabId = TabID.Storyline;
    }
  }

  createHTML() {
    this.userReview = (this.series.userReview === null ? '' : this.series.userReview).replace(/\n/g, '<br>');
    this.changeDetectionRef.markForCheck();
  }

  setContinuePoint() {
    this.readerService.hasSeriesProgress(this.seriesId).subscribe(hasProgress => {
      this.hasReadingProgress = hasProgress;
      this.changeDetectionRef.markForCheck();
    });
    this.readerService.getCurrentChapter(this.seriesId).subscribe(chapter => {
      this.currentlyReadingChapter = chapter;
      this.changeDetectionRef.markForCheck();
    });
  }

  markVolumeAsRead(vol: Volume) {
    if (this.series === undefined) {
      return;
    }

    this.actionService.markVolumeAsRead(this.seriesId, vol, () => {
      this.setContinuePoint();
      this.actionInProgress = false;
      this.changeDetectionRef.markForCheck();
    });
  }

  markVolumeAsUnread(vol: Volume) {
    if (this.series === undefined) {
      return;
    }

    this.actionService.markVolumeAsUnread(this.seriesId, vol, () => {
      this.setContinuePoint();
      this.actionInProgress = false;
      this.changeDetectionRef.markForCheck();
    });
  }

  markChapterAsRead(chapter: Chapter) {
    if (this.series === undefined) {
      return;
    }

    this.actionService.markChapterAsRead(this.seriesId, chapter, () => {
      this.setContinuePoint();
      this.actionInProgress = false;
      this.changeDetectionRef.markForCheck();
    });
  }

  markChapterAsUnread(chapter: Chapter) {
    if (this.series === undefined) {
      return;
    }

    this.actionService.markChapterAsUnread(this.seriesId, chapter, () => {
      this.setContinuePoint();
      this.actionInProgress = false;
      this.changeDetectionRef.markForCheck();
    });
  }

  read() {
    if (this.currentlyReadingChapter !== undefined) {
      this.openChapter(this.currentlyReadingChapter);
      return;
    }

    this.readerService.getCurrentChapter(this.seriesId).subscribe(chapter => {
      this.openChapter(chapter);
    });
  }

  updateRating(rating: any) {
    if (this.series === undefined) {
      return;
    }

    this.seriesService.updateRating(this.series?.id, this.series?.userRating, this.series?.userReview).subscribe(() => {
      this.createHTML();
    });
  }

  openChapter(chapter: Chapter, incognitoMode = false) {
    if (chapter.pages === 0) {
      this.toastr.error('There are no pages. Kavita was not able to read this archive.');
      return;
    }
    this.router.navigate(this.readerService.getNavigationArray(this.libraryId, this.seriesId, chapter.id, chapter.files[0].format), {queryParams: {incognitoMode}});
  }

  openVolume(volume: Volume) {
    if (volume.chapters === undefined || volume.chapters?.length === 0) {
      this.toastr.error('There are no chapters to this volume. Cannot read.');
      return;
    }

    // If user has progress on the volume, load them where they left off
    if (volume.pagesRead < volume.pages && volume.pagesRead > 0) {
      // Find the continue point chapter and load it
      const unreadChapters = volume.chapters.filter(item => item.pagesRead < item.pages);
      if (unreadChapters.length > 0) {
        this.openChapter(unreadChapters[0]);
        return;
      }
      this.openChapter(volume.chapters[0]);
      return;
    }

    // Sort the chapters, then grab first if no reading progress
    this.openChapter([...volume.chapters].sort(this.utilityService.sortChapters)[0]);
  }

  isNullOrEmpty(val: string) {
    return val === null || val === undefined || val === ''; // TODO: Validate if this code is used
  }

  openViewInfo(data: Volume | Chapter) {
    const drawerRef = this.offcanvasService.open(CardDetailDrawerComponent, {position: 'bottom'});
    drawerRef.componentInstance.data = data;
    drawerRef.componentInstance.parentName = this.series?.name;
    drawerRef.componentInstance.seriesId = this.series?.id;
    drawerRef.componentInstance.libraryId = this.series?.libraryId;
  }

  openEditSeriesModal() {
    const modalRef = this.modalService.open(EditSeriesModalComponent, {  size: 'xl' });
    modalRef.componentInstance.series = this.series;
    modalRef.closed.subscribe((closeResult: {success: boolean, series: Series, coverImageUpdate: boolean}) => {
      window.scrollTo(0, 0);
      if (closeResult.success) {
        this.seriesService.getSeries(this.seriesId).subscribe(s => {
          this.series = s;
          this.changeDetectionRef.detectChanges();
        });
        
        this.loadSeries(this.seriesId);
      }

      if (closeResult.coverImageUpdate) {
        this.toastr.info('It can take up to a minute for your browser to refresh the image. Until then, the old image may be shown on some pages.');
      }
    });
  }

  async promptToReview() {
    // TODO: After a review has been set, we might just want to show an edit icon next to star rating which opens the review, instead of prompting each time.
    const shouldPrompt = this.isNullOrEmpty(this.series.userReview);
    const config = new ConfirmConfig();
    config.header = 'Confirm';
    config.content = 'Do you want to write a review?';
    config.buttons.push({text: 'No', type: 'secondary'});
    config.buttons.push({text: 'Yes', type: 'primary'});
    if (shouldPrompt && await this.confirmService.confirm('Do you want to write a review?', config)) {
      this.openReviewModal();
    }
  }

  openReviewModal(force = false) {
    const modalRef = this.modalService.open(ReviewSeriesModalComponent, { scrollable: true, size: 'lg' });
    modalRef.componentInstance.series = this.series;
    modalRef.closed.subscribe((closeResult: {success: boolean, review: string, rating: number}) => {
      if (closeResult.success && this.series !== undefined) {
        this.series.userReview = closeResult.review;
        this.series.userRating = closeResult.rating;
        this.createHTML();
      }
    });
  }

  preventClick(event: any) {
    event.stopPropagation();
    event.preventDefault();
  }

  performAction(action: ActionItem<any>) {
    if (typeof action.callback === 'function') {
      action.callback(action.action, this.series);
    }
  }

  downloadSeries() {
    this.downloadService.download('series', this.series, (d) => {
      if (d) {
        this.downloadInProgress = true;
      } else {
        this.downloadInProgress = false;
      }
      this.changeDetectionRef.markForCheck();
    });
  }

  updateSortOrder() {
    this.isAscendingSort = !this.isAscendingSort;
    // if (this.filter.sortOptions === null) {
    //   this.filter.sortOptions = {
    //     isAscending: this.isAscendingSort,
    //     sortField: SortField.SortName
    //   }
    // }

    // this.filter.sortOptions.isAscending = this.isAscendingSort;
  }
}

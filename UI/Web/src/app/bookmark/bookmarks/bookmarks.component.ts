import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { take, Subject } from 'rxjs';
import { BulkSelectionService } from 'src/app/cards/bulk-selection.service';
import { ConfirmService } from 'src/app/shared/confirm.service';
import { DownloadService } from 'src/app/shared/_services/download.service';
import { KEY_CODES } from 'src/app/shared/_services/utility.service';
import { PageBookmark } from 'src/app/_models/page-bookmark';
import { Series } from 'src/app/_models/series';
import { Action, ActionFactoryService, ActionItem } from 'src/app/_services/action-factory.service';
import { ImageService } from 'src/app/_services/image.service';
import { ReaderService } from 'src/app/_services/reader.service';
import { SeriesService } from 'src/app/_services/series.service';

@Component({
  selector: 'app-bookmarks',
  templateUrl: './bookmarks.component.html',
  styleUrls: ['./bookmarks.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BookmarksComponent implements OnInit, OnDestroy {

  bookmarks: Array<PageBookmark> = [];
  series: Array<Series> = [];
  loadingBookmarks: boolean = false;
  seriesIds: {[id: number]: number} = {};
  downloadingSeries: {[id: number]: boolean} = {};
  clearingSeries: {[id: number]: boolean} = {};
  actions: ActionItem<Series>[] = [];

  trackByIdentity = (index: number, item: Series) => `${item.name}_${item.localizedName}_${item.pagesRead}`;
  refresh: EventEmitter<void> = new EventEmitter();

  private onDestroy: Subject<void> = new Subject<void>();
  
  constructor(private readerService: ReaderService, private seriesService: SeriesService, 
    private downloadService: DownloadService, private toastr: ToastrService,
    private confirmService: ConfirmService, public bulkSelectionService: BulkSelectionService, 
    public imageService: ImageService, private actionFactoryService: ActionFactoryService,
    private router: Router, private readonly cdRef: ChangeDetectorRef) { }

  ngOnInit(): void {
    this.loadBookmarks();

    this.actions = this.actionFactoryService.getBookmarkActions(this.handleAction.bind(this));
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

  async handleAction(action: Action, series: Series) {
    switch (action) {
      case(Action.Delete):
        this.clearBookmarks(series);
        break;
      case(Action.DownloadBookmark):
        this.downloadBookmarks(series);
        break;
      case(Action.ViewSeries):
        this.router.navigate(['library', series.libraryId, 'series', series.id]);
        break;
      default:
        break;
    }
  }

  bulkActionCallback = async (action: Action, data: any) => {
    const selectedSeriesIndexies = this.bulkSelectionService.getSelectedCardsForSource('bookmark');
    const selectedSeries = this.series.filter((series, index: number) => selectedSeriesIndexies.includes(index + ''));
    const seriesIds = selectedSeries.map(item => item.id);

    switch (action) {
      case Action.DownloadBookmark:
        this.downloadService.download('bookmark', this.bookmarks.filter(bmk => seriesIds.includes(bmk.seriesId)), (d) => {
          if (!d) {
            this.bulkSelectionService.deselectAll();
          }
        });
        break;
      case Action.Delete:
        if (!await this.confirmService.confirm('Are you sure you want to clear all bookmarks for multiple series? This cannot be undone.')) {
          break;
        }

        this.readerService.clearMultipleBookmarks(seriesIds).subscribe(() => {
          this.toastr.success('Bookmarks have been removed');
          this.bulkSelectionService.deselectAll();
          this.loadBookmarks();
        });
        break;
      default:
        break;
    }
  }

  loadBookmarks() {
    this.loadingBookmarks = true;
    this.cdRef.markForCheck();
    this.readerService.getAllBookmarks().pipe(take(1)).subscribe(bookmarks => {
      this.bookmarks = bookmarks;
      this.seriesIds = {};
      this.bookmarks.forEach(bmk => {
        if (!this.seriesIds.hasOwnProperty(bmk.seriesId)) {
          this.seriesIds[bmk.seriesId] = 1;
        } else {
          this.seriesIds[bmk.seriesId] += 1;
        }
        this.downloadingSeries[bmk.seriesId] = false;
        this.clearingSeries[bmk.seriesId] = false;
      });

      const ids = Object.keys(this.seriesIds).map(k => parseInt(k, 10));
      this.seriesService.getAllSeriesByIds(ids).subscribe(series => {
        this.series = series;
        this.loadingBookmarks = false;
        this.cdRef.markForCheck();
      });
      this.cdRef.markForCheck();
    });
  }

  viewBookmarks(series: Series) {
    this.router.navigate(['library', series.libraryId, 'series', series.id, 'manga', 0], {queryParams: {incognitoMode: false, bookmarkMode: true}});
  }

  async clearBookmarks(series: Series) {
    if (!await this.confirmService.confirm('Are you sure you want to clear all bookmarks for ' + series.name + '? This cannot be undone.')) {
      return;
    }

    this.clearingSeries[series.id] = true;
    this.cdRef.markForCheck();
    this.readerService.clearBookmarks(series.id).subscribe(() => {
      const index = this.series.indexOf(series);
      if (index > -1) {
        this.series.splice(index, 1);
      }
      this.clearingSeries[series.id] = false;
      this.toastr.success(series.name + '\'s bookmarks have been removed');
      this.refresh.emit();
      this.cdRef.markForCheck();
    });
  }

  getBookmarkPages(seriesId: number) {
    return this.seriesIds[seriesId];
  }

  downloadBookmarks(series: Series) {
    this.downloadingSeries[series.id] = true;
    this.cdRef.markForCheck();
    this.downloadService.download('bookmark', this.bookmarks.filter(bmk => bmk.seriesId === series.id), (d) => {
      if (!d) {
        this.downloadingSeries[series.id] = false;
        this.cdRef.markForCheck();
      }
    });
  }

}

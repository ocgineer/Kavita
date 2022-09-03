import { isNgTemplate } from '@angular/compiler';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { map, Subject, Observable, of, firstValueFrom, takeUntil, ReplaySubject } from 'rxjs';
import { UtilityService } from 'src/app/shared/_services/utility.service';
import { Series } from 'src/app/_models/series';
import { ExternalLinkKind, ExternalLinkKinds } from 'src/app/_models/series-detail/external-links-kind';
import { ImageService } from 'src/app/_services/image.service';
import { LibraryService } from 'src/app/_services/library.service';
import { SeriesService } from 'src/app/_services/series.service';

export interface ExternalLinkControl {
  website: string;
  formControl: UntypedFormControl;
}

@Component({
  selector: 'app-edit-series-external-links',
  templateUrl: './edit-series-external-links.component.html',
  styleUrls: ['./edit-series-external-links.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EditSeriesExternalLinksComponent implements OnInit, OnDestroy {

  @Input() series!: Series;
  /**
   * This will tell the component to save based on it's internal state
   */
  @Input() save: EventEmitter<void> = new EventEmitter();

  @Output() saveApi = new ReplaySubject(1);

  elinkOptions = ExternalLinkKinds;
  elinks: Array<ExternalLinkControl> = [];

  get ExternalLinkKind() {
    return ExternalLinkKind;
  }
  
  private onDestroy: Subject<void> = new Subject<void>();

  constructor(private seriesService: SeriesService, private utilityService: UtilityService, 
    public imageService: ImageService, private libraryService: LibraryService, 
    private readonly cdRef: ChangeDetectorRef) {}

  ngOnInit(): void {
    console.log("series external links ngoninit"); console.log(this.series.id);
    this.seriesService.getSeriesExternalLinks(566364).subscribe(async elink => {
      this.setupExternalLinkRows(elink.otherWebsite, ExternalLinkKind.OtherWebsite);
      this.setupExternalLinkRows(elink.aniList, ExternalLinkKind.AniList);
      this.setupExternalLinkRows(elink.mangaUpdates, ExternalLinkKind.MangaUpdates);
      this.setupExternalLinkRows(elink.myAnimeList, ExternalLinkKind.MyAnimeList);
      this.setupExternalLinkRows(elink.goodreads, ExternalLinkKind.Goodreads);
      this.cdRef.detectChanges();
    });

    this.save.pipe(takeUntil(this.onDestroy)).subscribe(() => this.saveState());
  }

  ngOnDestroy(): void {
      this.onDestroy.next();
      this.onDestroy.complete();
  }

  setupExternalLinkRows(elinks: Array<string>, kind: ExternalLinkKind) {
      elinks.map(async item => {
        return {website: item, formControl: new UntypedFormControl(kind, [])};
      }).forEach(async p => {
        this.elinks.push(await p);
        this.cdRef.markForCheck();
      });
  }

  async addNewExternalLink() {
    this.elinks.push({website: "", formControl: new UntypedFormControl(ExternalLinkKind.OtherWebsite, [])});
    this.cdRef.markForCheck();
  }

  removeExternalLink(index : number) {
    this.elinks.splice(index, 1);
    this.cdRef.markForCheck();
  }

  saveState() {
    const otherWebsite = this.elinks.filter(item => (parseInt(item.formControl.value, 10) as ExternalLinkKind) === ExternalLinkKind.OtherWebsite && item.website !== undefined).map(item => item.website);
    const aniList = this.elinks.filter(item => (parseInt(item.formControl.value, 10) as ExternalLinkKind) === ExternalLinkKind.AniList && item.website !== undefined).map(item => item.website);
    const mangaUpdates = this.elinks.filter(item => (parseInt(item.formControl.value, 10) as ExternalLinkKind) === ExternalLinkKind.MangaUpdates && item.website !== undefined).map(item => item.website);
    const myAnimeList = this.elinks.filter(item => (parseInt(item.formControl.value, 10) as ExternalLinkKind) === ExternalLinkKind.MyAnimeList && item.website !== undefined).map(item => item.website);
    const goodreads = this.elinks.filter(item => (parseInt(item.formControl.value, 10) as ExternalLinkKind) === ExternalLinkKind.Goodreads && item.website !== undefined).map(item => item.website);

    console.log(goodreads);

    // TODO: We can actually emit this onto an observable and in main parent, use mergeMap into the forkJoin
    this.seriesService.updateSeriesExternalLinks(566364, otherWebsite, aniList, mangaUpdates, myAnimeList, goodreads).subscribe(() => {});
  }

}

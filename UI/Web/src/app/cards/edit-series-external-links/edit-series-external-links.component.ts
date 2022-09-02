import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { map, Subject, Observable, of, firstValueFrom, takeUntil, ReplaySubject } from 'rxjs';
import { UtilityService } from 'src/app/shared/_services/utility.service';
import { SearchResult } from 'src/app/_models/search-result';
import { Series } from 'src/app/_models/series';
import { ExternalLinkKind, ExternalLinkKinds } from 'src/app/_models/series-detail/external-links-kind';
import { ImageService } from 'src/app/_services/image.service';
import { LibraryService } from 'src/app/_services/library.service';
import { SeriesService } from 'src/app/_services/series.service';

export interface ExternalLinkControl {
  website: string | undefined;
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
    //this.seriesService.getExternalLinksForSeries(this.series.id).subscribe(async elinks => {
    //  this.setupExternalLinkRows(elinks.otherWebsite, ExternalLinkKind.OtherWebsite);
    //  this.setupExternalLinkRows(elinks.goodreads, ExternalLinkKind.Goodreads);
    //  this.setupExternalLinkRows(elinks.myanimelist, ExternalLinkKind.MyAnimeList);
    //  this.setupExternalLinkRows(elinks.anilist, ExternalLinkKind.AniList);
    //  this.setupExternalLinkRows(elinks.mangaupdates, ExternalLinkKind.MangaUpdates);
    //  this.cdRef.detectChanges();
    //});

    /* some test values for UI mimicing getExternalLinsForSeries() */
    this.setupExternalLinkRows(["119375","11"], ExternalLinkKind.MyAnimeList);
    this.setupExternalLinkRows(["109310"], ExternalLinkKind.AniList);
    this.setupExternalLinkRows(["https://www.kavitareader.com"], ExternalLinkKind.OtherWebsite);

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
    console.log("when is this triggered?");
    //const otherWebsite = this.elinks.filter(item => (parseInt(item.formControl.value, 10) as ExternalLinkKind) === ExternalLinkKind.OtherWebsite && item.website !== undefined).map(item => item.website);

    const otherWebsite = ["test", "https://google.com"];
    // TODO: We can actually emit this onto an observable and in main parent, use mergeMap into the forkJoin
    //this.seriesService.updateExternalLinks(this.series.id, otherWebsite).subscribe(() => {});
  }

}

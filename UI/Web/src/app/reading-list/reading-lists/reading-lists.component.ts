import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { take } from 'rxjs/operators';
import { UtilityService } from 'src/app/shared/_services/utility.service';
import { JumpKey } from 'src/app/_models/jumpbar/jump-key';
import { PaginatedResult, Pagination } from 'src/app/_models/pagination';
import { ReadingList } from 'src/app/_models/reading-list';
import { AccountService } from 'src/app/_services/account.service';
import { Action, ActionFactoryService, ActionItem } from 'src/app/_services/action-factory.service';
import { ActionService } from 'src/app/_services/action.service';
import { ImageService } from 'src/app/_services/image.service';
import { ReadingListService } from 'src/app/_services/reading-list.service';

@Component({
  selector: 'app-reading-lists',
  templateUrl: './reading-lists.component.html',
  styleUrls: ['./reading-lists.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ReadingListsComponent implements OnInit {

  lists: ReadingList[] = [];
  loadingLists = false;
  pagination!: Pagination;
  isAdmin: boolean = false;
  jumpbarKeys: Array<JumpKey> = [];

  constructor(private readingListService: ReadingListService, public imageService: ImageService, private actionFactoryService: ActionFactoryService,
    private accountService: AccountService, private toastr: ToastrService, private router: Router, private actionService: ActionService,
    private utilityService: UtilityService, private readonly cdRef: ChangeDetectorRef) { }

  ngOnInit(): void {
    this.accountService.currentUser$.pipe(take(1)).subscribe(user => {
      if (user) {
        this.isAdmin = this.accountService.hasAdminRole(user);
        this.loadPage();
      }
    });
  }

  getActions(readingList: ReadingList) {
    return this.actionFactoryService.getReadingListActions(this.handleReadingListActionCallback.bind(this))
      .filter(action => this.readingListService.actionListFilter(action, readingList, this.isAdmin));
  }

  performAction(action: ActionItem<any>, readingList: ReadingList) {
    if (typeof action.callback === 'function') {
      action.callback(action.action, readingList);
    }
  }

  handleReadingListActionCallback(action: Action, readingList: ReadingList) {
    switch(action) {
      case Action.Delete:
        this.readingListService.delete(readingList.id).subscribe(() => {
          this.toastr.success('Reading list deleted');
          this.loadPage();
        });
        break;
      case Action.Edit:
        this.actionService.editReadingList(readingList, (updatedList: ReadingList) => {
          // Reload information around list
          readingList = updatedList;
          this.cdRef.markForCheck();
        });
        break;
    }
  }

  getPage() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('page');
  }

  loadPage() {
    const page = this.getPage();
    if (page != null) {
      this.pagination.currentPage = parseInt(page, 10);
    }
    this.loadingLists = true;
    this.cdRef.markForCheck();

    this.readingListService.getReadingLists(true).pipe(take(1)).subscribe((readingLists: PaginatedResult<ReadingList[]>) => {
      this.lists = readingLists.result;
      this.pagination = readingLists.pagination;
      this.jumpbarKeys = this.utilityService.getJumpKeys(readingLists.result, (rl: ReadingList) => rl.title);
      this.loadingLists = false;
      window.scrollTo(0, 0);
      this.cdRef.markForCheck();
    });
  }

  handleClick(list: ReadingList) {
    this.router.navigateByUrl('lists/' + list.id);
  }

}

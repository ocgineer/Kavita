import { Component, Input, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import { ConfirmService } from 'src/app/shared/confirm.service';
import { Library } from 'src/app/_models/library';
import { LibraryService } from 'src/app/_services/library.service';
import { SettingsService } from '../../settings.service';
import { DirectoryPickerComponent, DirectoryPickerResult } from '../directory-picker/directory-picker.component';

@Component({
  selector: 'app-library-editor-modal',
  templateUrl: './library-editor-modal.component.html',
  styleUrls: ['./library-editor-modal.component.scss']
})
export class LibraryEditorModalComponent implements OnInit {

  @Input() library: Library | undefined = undefined;

  libraryForm: FormGroup = new FormGroup({
    name: new FormControl('', [Validators.required]),
    type: new FormControl(0, [Validators.required])
  });

  selectedFolders: string[] = [];
  errorMessage = '';
  madeChanges = false;
  libraryTypes: string[] = []


  constructor(private modalService: NgbModal, private libraryService: LibraryService, public modal: NgbActiveModal, private settingService: SettingsService,
    private toastr: ToastrService, private confirmService: ConfirmService) { }

  ngOnInit(): void {

    this.settingService.getLibraryTypes().subscribe((types) => {
      this.libraryTypes = types;
    });
    this.setValues();
    
  }


  removeFolder(folder: string) {
    this.selectedFolders = this.selectedFolders.filter(item => item !== folder);
    this.madeChanges = true;
  }

  async submitLibrary() {
    const model = this.libraryForm.value;
    model.folders = this.selectedFolders;

    if (this.libraryForm.errors) {
      return;
    }

    if (this.library !== undefined) {
      model.id = this.library.id;
      model.folders = model.folders.map((item: string) => item.startsWith('\\') ? item.substr(1, item.length) : item);
      model.type = parseInt(model.type, 10);

      if (model.type !== this.library.type) {
        if (!await this.confirmService.confirm(`Changing library type will trigger a new scan with different parsing rules and may lead to 
        series being re-created and hence you may loose progress and bookmarks. You should backup before you do this. Are you sure you want to continue?`)) return;
      }

      this.libraryService.update(model).subscribe(() => {
        this.close(true);
      }, err => {
        this.errorMessage = err;
      });
    } else {
      model.folders = model.folders.map((item: string) => item.startsWith('\\') ? item.substr(1, item.length) : item);
      model.type = parseInt(model.type, 10);
      this.libraryService.create(model).subscribe(() => {
        this.toastr.success('Library created successfully.');
        this.toastr.info('A scan has been started.');
        this.close(true);
      }, err => {
        this.errorMessage = err;
      });
    }
  }

  close(returnVal= false) {
    const model = this.libraryForm.value;
    this.modal.close(returnVal);
  }

  reset() {
    this.setValues();
  }

  setValues() {
    if (this.library !== undefined) {
      this.libraryForm.get('name')?.setValue(this.library.name);
      this.libraryForm.get('type')?.setValue(this.library.type);
      this.selectedFolders = this.library.folders;
      this.madeChanges = false;
    }
  }

  openDirectoryPicker() {
    const modalRef = this.modalService.open(DirectoryPickerComponent, { scrollable: true, size: 'lg' });
    modalRef.closed.subscribe((closeResult: DirectoryPickerResult) => {
      if (closeResult.success) {
        if (!this.selectedFolders.includes(closeResult.folderPath)) {
          this.selectedFolders.push(closeResult.folderPath);
          this.madeChanges = true;
        }
      }
    });
  }

}

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SideNavCompanionBarComponent } from './side-nav-companion-bar/side-nav-companion-bar.component';
import { SideNavItemComponent } from './side-nav-item/side-nav-item.component';
import { SideNavComponent } from './side-nav/side-nav.component';
import { PipeModule } from '../pipe/pipe.module';
import { CardsModule } from '../cards/cards.module';
import { FormsModule } from '@angular/forms';



@NgModule({
  declarations: [
    SideNavCompanionBarComponent,
    SideNavItemComponent,
    SideNavComponent
  ],
  imports: [
    CommonModule,
    PipeModule,
    CardsModule,
    FormsModule,
  ],
  exports: [
    SideNavCompanionBarComponent,
    SideNavItemComponent,
    SideNavComponent
  ]
})
export class SidenavModule { }

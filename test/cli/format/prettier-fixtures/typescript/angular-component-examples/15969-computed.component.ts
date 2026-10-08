import { Component } from '@angular/core';

const template = "foobar";

@Component({
  [template]: `<h1>{{       hello }}</h1>`,
})
export class AppComponent {}

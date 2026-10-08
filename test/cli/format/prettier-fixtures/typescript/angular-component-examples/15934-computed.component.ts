import { Component } from '@angular/core';

const styles = "foobar";

@Component({
    selector: 'app-root',
    template: `
        <h1>My App</h1>
        <app-todo-list></app-todo-list>
    `,
    [styles]: `h1 { color: blue }`
})
export class AppComponent {}

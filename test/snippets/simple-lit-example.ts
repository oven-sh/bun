import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

export function test() {
  @customElement("simple-greeting")
  class SimpleGreeting extends LitElement {
    // Define scoped styles right with your component, in plain CSS
    static styles = css`
      :host {
        color: blue;
      }
    `;

    // Declare reactive properties
    @property()
    name?: string = "World";

    // Render the UI as a function of component state
    render() {
      return html`<p>Hello, ${this.name}!</p>`;
    }
  }

  return testDone(import.meta.url);
}

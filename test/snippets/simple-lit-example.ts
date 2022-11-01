import { LitElement, html, css } from "lit";
import { customElement, property, eventOptions } from "lit/decorators.js";

@customElement("my-element")
export class MyElement extends LitElement {
  static styles = css`
    :host {
      display: inline-block;
      padding: 10px;
      background: lightgray;
    }
    .planet {
      color: var(--planet-color, blue);
    }
  `;

  @property() planet = "Earth";

  render() {
    return html`
      <span @click=${this.togglePlanet} class="planet" id="planet-id"
        >${this.planet}</span
      >
    `;
  }

  @eventOptions({ once: true })
  togglePlanet() {
    this.planet = this.planet === "Earth" ? "Mars" : "Earth";
  }
}

export function setup() {
  let element = document.createElement("my-element");
  element.id = "my-element-id";
  document.body.appendChild(element);
}

export function test() {
  let element = document.getElementById("my-element-id");
  let shadowRoot = element.shadowRoot;
  let planet = shadowRoot.getElementById("planet-id");
  if (element.__planet !== "Earth") {
    throw new Error("Unexpected planet name: " + element.__planet);
  }
  planet.click();
  if (element.__planet !== "Mars") {
    throw new Error("Unexpected planet name: " + element.__planet);
  }
  planet.click();
  if (element.__planet !== "Mars") {
    throw new Error("Unexpected planet name: " + element.__planet);
  }

  return testDone(import.meta.url);
}

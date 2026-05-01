// @ts-nocheck
import { LitElement, html, css } from "lit";
import { customElement, property, eventOptions } from "lit/decorators.js";

var loadedResolve;
var loadedPromise = new Promise(resolve => {
  loadedResolve = resolve;
});

if (document?.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      loadedResolve();
    },
    { once: true },
  );
} else {
  loadedResolve();
}

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
    return html` <span @click=${this.togglePlanet} class="planet" id="planet-id">${this.planet}</span> `;
  }

  @eventOptions({ once: true })
  togglePlanet() {
    this.planet = this.planet === "Earth" ? "Mars" : "Earth";
  }
}

function setup() {
  let element = document.createElement("my-element");
  element.id = "my-element-id";
  document.body.appendChild(element);
}

export async function test() {
  setup();
  await loadedPromise;

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

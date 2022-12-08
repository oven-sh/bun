import {
__decorateClass as __decorateClass_4b4920c627822e1f
} from "http://localhost:8080/bun:wrap";
import {LitElement, html, css} from "http://localhost:8080/node_modules/lit/index.js";
import {customElement, property, eventOptions} from "http://localhost:8080/node_modules/lit/decorators.js";
var loadedResolve;
var loadedPromise = new Promise((resolve) => {
  loadedResolve = resolve;
});
if (document?.readyState === "loading")
  document.addEventListener("DOMContentLoaded", () => {
    loadedResolve();
  }, { once: true });
else
  loadedResolve();

export class MyElement extends LitElement {
  constructor() {
    super(...arguments);
    this.planet = "Earth";
  }
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
  render() {
    return html`
      <span @click=${this.togglePlanet} class="planet" id="planet-id"
        >${this.planet}</span
      >
    `;
  }
  togglePlanet() {
    this.planet = this.planet === "Earth" ? "Mars" : "Earth";
  }
}
__decorateClass_4b4920c627822e1f([
  property()
], MyElement.prototype, "planet", 2);
__decorateClass_4b4920c627822e1f([
  eventOptions({ once: true })
], MyElement.prototype, "togglePlanet", 1);
MyElement = __decorateClass_4b4920c627822e1f([
  customElement("my-element")
], MyElement);
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
  if (element.__planet !== "Earth")
    throw new Error("Unexpected planet name: " + element.__planet);
  planet.click();
  if (element.__planet !== "Mars")
    throw new Error("Unexpected planet name: " + element.__planet);
  planet.click();
  if (element.__planet !== "Mars")
    throw new Error("Unexpected planet name: " + element.__planet);
  return testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/simple-lit-example.ts.map

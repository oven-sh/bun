// Checked with and without lib.dom.d.ts. What only holds in one of the two is in bun-types.test.ts, under "bun:dom".

import type { HTMLDivElement, MutationRecord, ProgressEvent, Text, WindowOptions } from "bun:dom";
import dom, {
  CSS,
  CustomEvent,
  DOMParser,
  Document,
  Element,
  Event,
  EventTarget,
  FileReader,
  FormData,
  HTMLAnchorElement,
  HTMLElement,
  HTMLInputElement,
  KeyboardEvent,
  MouseEvent,
  MutationObserver,
  Node,
  NodeFilter,
  ResizeObserver,
  SVGElement,
  Window,
  XMLSerializer,
} from "bun:dom";
import { expectType } from "./utilities";

// Parsing and querying
const document = new DOMParser().parseFromString(`<a href="/docs" class="nav">Docs</a>`, "text/html");
expectType(document).is<Document>();
expectType(document.title).is<string>();
expectType(document.body).is<HTMLElement>();
expectType(document.querySelector("a")).is<HTMLAnchorElement | null>();
expectType(document.querySelector("a")?.href).is<string | undefined>();
expectType(document.querySelector(".nav")).is<Element | null>();
expectType(document.querySelector<HTMLInputElement>("input.nav")).is<HTMLInputElement | null>();
expectType(document.getElementById("nav")).is<HTMLElement | null>();
expectType(document.body.closest("a")).is<HTMLAnchorElement | null>();
expectType(document.body.matches("body")).is<boolean>();
for (const anchor of document.querySelectorAll("a")) {
  expectType(anchor).is<HTMLAnchorElement>();
}
expectType(Array.from(document.querySelectorAll(".nav"))).is<Element[]>();
expectType(document.getElementsByTagName("input")[0]).is<HTMLInputElement | undefined>();
// @ts-expect-error - not a type DOMParser knows
new DOMParser().parseFromString("", "text/plain");

// Changing and serializing
const input = document.createElement("input");
expectType(input).is<HTMLInputElement>();
expectType(input.value).is<string>();
expectType(input.checked).is<boolean>();
input.classList.add("a", "b");
input.dataset.kind = "text";
input.style.backgroundColor = "red";
input.style.setProperty("--gap", "1px");
input.setAttribute("name", "q");
document.body.append(input, "text");
document.body.insertAdjacentHTML("beforeend", "<hr>");
input.remove();
expectType(document.body.innerHTML).is<string>();
expectType(document.documentElement.outerHTML).is<string>();
expectType(new XMLSerializer().serializeToString(document)).is<string>();
expectType(document.createTextNode("x")).is<Text>();
document.createElementNS("http://www.w3.org/2000/svg", "circle") satisfies SVGElement;
expectType(document.createElement("unknown-element")).is<HTMLElement>();

// Window
const window = new Window({ url: "https://example.com/app" });
new Window();
new Window({});
new Window({ url: new URL("https://example.com/") });
({ url: "https://example.com/" }) satisfies WindowOptions;
// @ts-expect-error - a string or a URL
new Window({ url: 1 });
// @ts-expect-error - there is one option
new Window({ html: "<p></p>" });
window satisfies Window;
window satisfies EventTarget;
expectType(window.document).is<Document>();
expectType(window.document.defaultView?.document).is<Document | undefined>();
expectType(window.location.href).is<string>();
expectType(window.innerWidth).is<number>();
window.location.hash = "#a";
window.history.pushState({ page: 1 }, "", "/page/1");
window.localStorage.setItem("theme", "dark");
expectType(window.localStorage.getItem("theme")).is<string | null>();
expectType(window.sessionStorage.length).is<number>();
expectType(window.getComputedStyle(window.document.body).color).is<string>();
expectType(window.getComputedStyle(window.document.body).getPropertyValue("--gap")).is<string>();
expectType(window.matchMedia("screen").matches).is<boolean>();
window.cancelAnimationFrame(window.requestAnimationFrame(time => expectType(time).is<number>()));
window.clearTimeout(window.setTimeout(() => {}, 1));
window.queueMicrotask(() => {});
window.close();

// A window has the interfaces as properties
new window.MouseEvent("click") satisfies MouseEvent;
new window.DOMParser().parseFromString("", "text/html") satisfies Document;
new window.Image(1, 1).src satisfies string;
class Greeting extends window.HTMLElement {
  connectedCallback() {
    this.textContent = "hello";
  }
}
window.customElements.define("x-greeting", Greeting);
new Greeting() satisfies HTMLElement;

// Events
document.body.addEventListener("click", event => {
  event satisfies MouseEvent;
  expectType(event.clientX).is<number>();
  expectType(event.target).is<EventTarget | null>();
});
document.addEventListener("keydown", event => expectType(event).is<KeyboardEvent>(), { once: true });
document.body.addEventListener("anything", event => expectType(event).is<Event>());
document.body.addEventListener("anything", { handleEvent(event) {} });
window.addEventListener("hashchange", event => expectType(event.newURL).is<string>());
window.addEventListener("message", event => event.data);
document.body.onclick = event => event satisfies MouseEvent;
document.body.onclick = null;
expectType(
  document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 1, view: window })),
).is<boolean>();
expectType(new KeyboardEvent("keydown", { key: "a", ctrlKey: true }).key).is<string>();
expectType(new CustomEvent("x", { detail: 1, bubbles: true }).detail).is<number>();
document.body.click();
input.focus();
new MutationObserver((records, observer) => {
  expectType(records).is<MutationRecord[]>();
  observer.disconnect();
}).observe(document.body, { childList: true, subtree: true });
new ResizeObserver(entries => expectType(entries[0]?.contentRect.width).is<number | undefined>()).observe(
  document.body,
);

// instanceof
declare const node: Node;
if (node instanceof HTMLAnchorElement) expectType(node.href).is<string>();
if (node instanceof Element) expectType(node.getAttribute("id")).is<string | null>();
if (node instanceof window.HTMLInputElement) expectType(node.value).is<string>();
declare const target: EventTarget | null;
if (target instanceof HTMLElement) expectType(target.hidden).extends<boolean | string>();
expectType(node.nodeType === Node.ELEMENT_NODE).is<boolean>();

// Names that are only imported as types
declare const div: HTMLDivElement;
div satisfies HTMLElement;
div satisfies Element;
div satisfies Node;
div satisfies EventTarget;
declare const progress: ProgressEvent<FileReader>;
expectType(progress.loaded).is<number>();
progress.target?.result satisfies string | ArrayBuffer | null | undefined;

// The classes that Bun has as globals are those classes
expectType<Event>().is<globalThis.Event>();
expectType<EventTarget>().is<globalThis.EventTarget>();
expectType<CustomEvent<string>>().is<globalThis.CustomEvent<string>>();
expectType<typeof Event>().is<typeof globalThis.Event>();
expectType<typeof dom.AbortSignal>().is<typeof globalThis.AbortSignal>();
expectType<typeof dom.Blob>().is<typeof globalThis.Blob>();
expectType<typeof dom.File>().is<typeof globalThis.File>();
const form = document.createElement("form");
expectType(new FormData(form)).is<globalThis.FormData>();
expectType(new FormData(form, form.querySelector("button"))).is<globalThis.FormData>();
new FormData();

// The rest
expectType(CSS.escape("a b")).is<string>();
expectType(CSS.supports("display", "grid")).is<boolean>();
const skipEverything: NodeFilter = () => NodeFilter.FILTER_SKIP;
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, skipEverything);
expectType(walker.nextNode()).is<Node | null>();
document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, { acceptNode: () => NodeFilter.FILTER_ACCEPT });
expectType(dom.DOMParser).is<typeof DOMParser>();
expectType(dom.Window).is<typeof Window>();
// @ts-expect-error - the default export does not have itself
dom.default;
// @ts-expect-error - not an export
dom.IntersectionObserver;

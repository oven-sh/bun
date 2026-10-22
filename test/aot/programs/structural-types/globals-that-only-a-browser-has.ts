function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function inBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function titleOr(fallback: string): string {
  return typeof document === "undefined" ? fallback : document.title;
}

function widthOr(fallback: number): number {
  return typeof innerWidth === "number" ? innerWidth : fallback;
}

function title(): string {
  return document.title;
}

function width(): number {
  return window.innerWidth;
}

show("typeof", () => [typeof window, typeof document, typeof innerWidth, typeof HTMLElement, typeof XMLHttpRequest, typeof requestAnimationFrame, typeof history]);
show("is this a browser", () => inBrowser());
show("guarded text", () => titleOr("no document"));
show("guarded number", () => [widthOr(800), widthOr(800) + 1]);
show("the text", () => title());
show("the number", () => width());
show("the number by its bare name", () => innerWidth + 1);
show("a method", () => document.createElement("div"));
show("a method if there", () => document?.createElement("div"));
show("a function", () => requestAnimationFrame(() => {}));
show("a class constructed", () => new XMLHttpRequest());
show("a class extended", () => {
  class Card extends HTMLElement {
    size: number = 1;
  }
  return new Card().size;
});
show("instanceof", () => ({}) instanceof HTMLElement);
show("through globalThis", () => [typeof globalThis.document, typeof globalThis.window, typeof globalThis.innerWidth]);
show("a member through globalThis", () => globalThis.document.title);
show("the number through globalThis", () => [globalThis.innerWidth, globalThis.innerWidth + 1]);
show("in", () => ["document" in globalThis, "window" in globalThis, "innerWidth" in globalThis]);
show("a store", () => (document.title = "stored"));
show("a store to the number", () => {
  innerWidth = 5;
  return "stored";
});

let sum = 0;
let failures = 0;
for (let i = 0; i < 2000; i++) {
  sum += widthOr(1) + titleOr("ab").length + (inBrowser() ? 100 : 0);
  try {
    width();
  } catch (error) {
    if (error instanceof ReferenceError) failures++;
  }
}
show("2000 rounds", () => [sum, failures]);

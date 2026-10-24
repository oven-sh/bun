interface Loose {
  width?: number;
  title?: string;
  inner?: { depth: number };
}

type Strict = Required<Loose>;

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function width(s: Strict): number {
  return s.width * 2;
}

function title(s: Strict): number {
  return s.title.length;
}

function depth(s: Strict): number {
  return s.inner.depth;
}

function state(s: Strict): string {
  return Object.keys(s).join() + " " + JSON.stringify(s) + " " + typeof s.width + " " + typeof s.title + " " + typeof s.inner;
}

function fresh(): Strict {
  return { width: 2, title: "four", inner: { depth: 6 } };
}

function strip(l: Loose): void {
  delete l.width;
  delete l.title;
  delete l.inner;
}

function blank(l: Loose): void {
  l.width = undefined;
  l.title = undefined;
  l.inner = undefined;
}

function all(label: string, s: Strict): void {
  attempt(label + ", number", () => width(s));
  attempt(label + ", string", () => title(s));
  attempt(label + ", object", () => depth(s));
  console.log(label + ", state: " + state(s));
}

all("untouched", fresh());

const deleted = fresh();
strip(deleted);
all("deleted through the alias", deleted);

const blanked = fresh();
blank(blanked);
all("set to undefined through the alias", blanked);

const local = fresh();
const alias: Loose = local;
delete alias.width;
console.log("local: " + (local.width + 1) + " " + (local.width | 0) + " " + ("width" in local));

const steady = fresh();
let sum = 0;
for (let i = 0; i < 2000; i++) sum += width(steady) + title(steady) + depth(steady);
console.log("2000 honest: " + sum);
strip(steady);
all("then stripped", steady);

const looped = fresh();
let total = 0;
attempt("stripped in the middle of a loop", () => {
  for (let i = 0; i < 2000; i++) {
    total += looped.inner.depth;
    if (i === 1200) strip(looped);
  }
  return "finished";
});
console.log("the loop got to: " + total);

class Panel {
  strict: Strict = fresh();
  list: Strict[] = [fresh(), fresh()];
  measure(): number {
    return this.strict.width + this.list[0].width + this.list[1].inner.depth;
  }
}

const panel = new Panel();
console.log("fields and elements: " + panel.measure());
strip(panel.strict);
console.log("the field stripped: " + panel.measure());
strip(panel.list[1]);
attempt("an element stripped", () => panel.measure());

const rebuilt = fresh();
strip(rebuilt);
Object.assign(rebuilt, { inner: { depth: 1 }, title: "t", width: 1 });
all("stripped and filled in another order", rebuilt);

const partialOfRequired: Partial<Strict> = {};
const roundTrip: Loose = partialOfRequired;
console.log("Partial<Required<T>> is T again: " + JSON.stringify(roundTrip) + " " + roundTrip.width);

export {};

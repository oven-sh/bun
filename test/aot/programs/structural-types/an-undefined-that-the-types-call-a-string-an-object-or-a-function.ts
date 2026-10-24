function attempt(label: string, body: () => unknown): void {
  try {
    const value = body();
    console.log(label + ": " + typeof value + " " + String(value));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Inner {
  x: number;
}

interface Whole {
  text: string;
  flag: boolean;
  inner: Inner;
  list: number[];
  run: () => number;
}

class Full {
  text = "text";
  flag = true;
  inner: Inner = { x: 1 };
  list: number[] = [1, 2];
  run = (): number => 7;
}

function honest(): Whole {
  return { text: "text", flag: true, inner: { x: 1 }, list: [1, 2], run: () => 7 };
}

function strip(w: Partial<Whole>): void {
  delete w.text;
  delete w.flag;
  delete w.inner;
  delete w.list;
  delete w.run;
}

function blank(w: Partial<Whole>): void {
  w.text = undefined;
  w.flag = undefined;
  w.inner = undefined;
  w.list = undefined;
  w.run = undefined;
}

const sources: [string, () => Whole][] = [
  ["honest", honest],
  ["members deleted", () => { const w = honest(); strip(w); return w; }],
  ["fields of a class deleted", () => { const w = new Full(); strip(w); return w; }],
  ["undefined stored", () => { const w = honest(); blank(w); return w; }],
  ["undefined stored into fields", () => { const w = new Full(); blank(w); return w; }],
  ["only the prototype", () => Object.create(Full.prototype)],
];

function lengthOf(s: string): number {
  return s.length;
}

function shout(s: string): string {
  return s.toUpperCase();
}

function glue(s: string): string {
  return s + "!";
}

function xOf(i: Inner): number {
  return i.x;
}

function first(list: number[]): number {
  return list[0];
}

function total(list: number[]): number {
  let sum = 0;
  for (const n of list) sum += n;
  return sum;
}

function call(f: () => number): number {
  return f();
}

function choose(flag: boolean): string {
  return flag ? "yes" : "no";
}

class Keeper {
  text = "";
  flag = false;
  inner: Inner = { x: 0 };
  keep(w: Whole): this {
    this.text = w.text;
    this.flag = w.flag;
    this.inner = w.inner;
    return this;
  }
}

for (let i = 0; i < 2000; i++) {
  const w = honest();
  lengthOf(w.text) + xOf(w.inner) + first(w.list) + total(w.list) + call(w.run);
  shout(w.text) + glue(w.text) + choose(w.flag);
  new Keeper().keep(w);
}

for (const [label, make] of sources) {
  attempt(label + ", text, its length", () => lengthOf(make().text));
  attempt(label + ", text, a method", () => shout(make().text));
  attempt(label + ", text, glued", () => glue(make().text));
  attempt(label + ", text, in a template", () => `<${make().text}>`);
  attempt(label + ", text, compared", () => make().text === "text");
  attempt(label + ", text, as a key", () => ({ text: 1, undefined: 2 })[make().text === "text" ? "text" : "undefined"]);
  attempt(label + ", text, spread", () => [...make().text].length);
  attempt(label + ", text, in a list", () => [make().text, "b"].join("+"));
  attempt(label + ", text, or a default", () => make().text || "default");
  attempt(label + ", flag, chosen", () => choose(make().flag));
  attempt(label + ", flag, negated", () => !make().flag);
  attempt(label + ", flag, compared", () => make().flag === false);
  attempt(label + ", flag, as json", () => JSON.stringify([make().flag]));
  attempt(label + ", inner, a member", () => xOf(make().inner));
  attempt(label + ", inner, an optional chain", () => make().inner?.x);
  attempt(label + ", inner, spread", () => JSON.stringify({ ...make().inner }));
  attempt(label + ", inner, keys", () => Object.keys(make().inner).join());
  attempt(label + ", inner, a pattern", () => (({ x }: Inner) => x)(make().inner));
  attempt(label + ", inner, in", () => "x" in make().inner);
  attempt(label + ", inner, a store", () => (make().inner.x = 5));
  attempt(label + ", list, its first", () => first(make().list));
  attempt(label + ", list, summed", () => total(make().list));
  attempt(label + ", list, its length", () => make().list.length);
  attempt(label + ", list, spread", () => [...make().list].length);
  attempt(label + ", list, isArray", () => Array.isArray(make().list));
  attempt(label + ", run, called", () => call(make().run));
  attempt(label + ", run, called as a member", () => make().run());
  attempt(label + ", run, an optional call", () => make().run?.());
  attempt(label + ", run, typeof", () => typeof make().run);
  attempt(label + ", kept in typed fields", () => JSON.stringify(new Keeper().keep(make())) + " " + Object.keys(new Keeper().keep(make())).join());
  attempt(label + ", read back from typed fields", () => glue(new Keeper().keep(make()).text) + choose(new Keeper().keep(make()).flag));
  attempt(label + ", a member of a kept member", () => new Keeper().keep(make()).inner.x);
}

export {};

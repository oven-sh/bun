interface Settings {
  theme: string;
  size?: number;
  note?: string;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function setTheme(s: Settings, theme: string): string {
  s.theme = theme;
  return s.theme;
}

function setSize(s: Settings, size: number): number | undefined {
  s.size = size;
  return s.size;
}

function dropSize(s: Settings): boolean {
  return delete s.size;
}

function dropNote(s: Settings): boolean {
  return delete s.note;
}

function state(s: Settings): string {
  return JSON.stringify(s) + " sealed " + Object.isSealed(s) + " frozen " + Object.isFrozen(s) + " extensible " + Object.isExtensible(s);
}

const makers: [string, () => Settings][] = [
  ["open, without size", () => ({ theme: "a" })],
  ["open, with size", () => ({ theme: "a", size: 1 })],
  ["sealed, without size", () => Object.seal({ theme: "a" })],
  ["sealed, with size", () => Object.seal({ theme: "a", size: 1 })],
  ["not extensible, without size", () => Object.preventExtensions({ theme: "a" })],
  ["not extensible, with size", () => Object.preventExtensions({ theme: "a", size: 1 })],
  ["frozen, without size", () => Object.freeze({ theme: "a" })],
  ["frozen, with size", () => Object.freeze({ theme: "a", size: 1 })],
];

for (const [label, make] of makers) {
  const a = make();
  attempt(label + ", a member it has is stored", () => setTheme(a, "b"));
  console.log("  " + state(a));
  const b = make();
  attempt(label + ", size is stored", () => setSize(b, 2));
  console.log("  " + state(b));
  const c = make();
  attempt(label + ", size is deleted", () => dropSize(c));
  console.log("  " + state(c));
  const d = make();
  attempt(label + ", a member it never had is deleted", () => dropNote(d));
  console.log("  " + state(d));
  const e = make();
  attempt(label + ", deleted and stored again", () => (dropSize(e), setSize(e, 3)));
  console.log("  " + state(e));
  const f = make();
  attempt(label + ", ??=", () => (f.size ??= 4));
  console.log("  " + state(f));
  const g = make();
  attempt(label + ", Object.assign", () => JSON.stringify(Object.assign(g, { note: "n" })));
  console.log("  " + state(g));
}

const open: Settings = { theme: "open" };
for (let i = 0; i < 2000; i++) {
  setSize(open, i);
  dropSize(open);
}
console.log("2000 honest rounds: " + state(open));
const sealed: Settings = Object.seal({ theme: "sealed" });
attempt("then a sealed one, stored", () => setSize(sealed, 1));
const sealedWith: Settings = Object.seal({ theme: "sealed", size: 1 });
attempt("then a sealed one, deleted", () => dropSize(sealedWith));
attempt("then the open one", () => setSize(open, 1));

class Panel {
  settings: Settings = Object.seal({ theme: "panel" });
  resize(n: number): number | undefined {
    this.settings.size = n;
    return this.settings.size;
  }
}
attempt("through a field", () => new Panel().resize(5));

const list: Settings[] = [{ theme: "x" }, Object.preventExtensions({ theme: "y" }), { theme: "z" }];
attempt("through elements", () => list.map(s => setSize(s, 6)).join());
console.log("the array: " + JSON.stringify(list));

export {};

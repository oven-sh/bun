import { addMany, addSize, defaultSize, dropSize, dropTheme } from "./changes.cjs";

interface Settings {
  theme: string;
  size?: number;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function strictAdd(s: Settings, value: number): number | undefined {
  s.size = value;
  return s.size;
}

function strictDrop(s: Settings): boolean {
  return delete s.size;
}

function state(s: Settings): string {
  return JSON.stringify(s) + " size in it " + ("size" in s) + " reads " + s.size + " theme " + s.theme;
}

const makers: [string, () => Settings][] = [
  ["open, without size", () => ({ theme: "a" })],
  ["open, with size", () => ({ size: 1, theme: "a" })],
  ["sealed, without size", () => Object.seal({ theme: "a" })],
  ["sealed, with size", () => Object.seal({ size: 1, theme: "a" })],
  ["not extensible, without size", () => Object.preventExtensions({ theme: "a" })],
  ["not extensible, with size", () => Object.preventExtensions({ size: 1, theme: "a" })],
  ["frozen, with size", () => Object.freeze({ size: 1, theme: "a" })],
];

for (const [label, make] of makers) {
  const uses: [string, (s: Settings) => unknown][] = [
    ["strict add", s => strictAdd(s, 5)],
    ["sloppy add", s => addSize(s, 5)],
    ["strict delete", s => strictDrop(s)],
    ["sloppy delete", s => dropSize(s)],
    ["sloppy delete of a required member", s => dropTheme(s)],
    ["sloppy ??=", s => defaultSize(s, 6)],
    ["sloppy delete, then sloppy add", s => dropSize(s) + " " + addSize(s, 7)],
  ];
  for (const [name, use] of uses) {
    const s = make();
    attempt(label + ", " + name, () => use(s));
    console.log("  " + state(s));
  }
}

const open: Settings = { theme: "open" };
for (let i = 0; i < 2000; i++) {
  addSize(open, i);
  dropSize(open);
}
console.log("2000 honest rounds: " + state(open));
attempt("then sealed, sloppy add", () => addSize(Object.seal({ theme: "s" }), 1));
attempt("then sealed, sloppy delete", () => dropSize(Object.seal({ theme: "s", size: 1 })));

const list: Settings[] = [];
for (let i = 0; i < 50; i++) list.push(i % 5 === 2 ? Object.preventExtensions({ theme: "t" + i }) : { theme: "t" + i });
attempt("a sloppy loop over open and closed elements", () => addMany(list, 3));
console.log("with a size afterwards: " + list.filter(s => s.size !== undefined).length);

function themeLength(s: Settings): number {
  return s.theme.length;
}
const stripped: Settings = { theme: "gone", size: 1 };
console.log("before: " + themeLength(stripped));
dropTheme(stripped);
attempt("a required member was deleted by sloppy code", () => themeLength(stripped));
console.log("  " + state(stripped));

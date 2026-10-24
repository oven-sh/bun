class Mixer {
  mix(a: number, b: number, c: number): string {
    return "three: " + a + " " + b + " " + c;
  }
}

function mixOf(m: Mixer): string {
  return m.mix(1, 2, 3);
}

function spreadInto(m: Mixer, values: [number, number, number]): string {
  return m.mix(...values);
}

function round(label: string, m: Mixer): void {
  console.log(label + ": " + m.mix(1, 2, 3) + " | " + mixOf(m) + " | " + spreadInto(m, [4, 5, 6]) + " | length " + m.mix.length);
}

const m = new Mixer();
const other = new Mixer();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += mixOf(m).length + mixOf(other).length;
console.log("2000 honest: " + warm);
round("the method", m);

const replacements: [string, (a: number, b: number, c: number) => string][] = [
  ["none", () => "none"],
  ["one", a => "one: " + a],
  ["two", (a, b) => "two: " + a + " " + b],
  ["a fourth that is optional", (a: number, b: number, c: number, d?: number) => "four: " + a + " " + b + " " + c + " " + d],
  ["a fourth with a default", (a: number, b: number, c: number, d: number = 40) => "four: " + a + " " + b + " " + c + " " + d],
  ["a default in the middle", (a: number, b: number = 20, c?: number) => "defaults: " + a + " " + b + " " + c],
  ["rest", (...all: number[]) => "rest: " + all.length + " " + all.join()],
  ["one and rest", (a: number, ...more: number[]) => "one and rest: " + a + " " + more.length + " " + more.join()],
  [
    "the arguments object",
    function () {
      return "arguments: " + arguments.length + " " + Array.from(arguments).join();
    },
  ],
  ["a pattern with a default", (a: number, b: number, c: number, { d }: { d: number } = { d: 44 }) => "pattern: " + a + " " + b + " " + c + " " + d],
  ["wider parameters", (a: number | string, b: unknown, c: number | undefined) => "wider: " + typeof a + " " + typeof b + " " + typeof c],
];

for (const [label, replacement] of replacements) {
  m.mix = replacement;
  round("own, " + label, m);
}
round("the other", other);

Reflect.deleteProperty(m, "mix");
round("uncovered", m);

const original = Mixer.prototype.mix;
for (const [label, replacement] of replacements) {
  Mixer.prototype.mix = replacement;
  round("on the prototype, " + label, other);
}
Mixer.prototype.mix = original;
round("put back", other);

export {};

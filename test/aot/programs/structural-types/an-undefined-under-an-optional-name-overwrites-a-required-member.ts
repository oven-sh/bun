interface Options {
  size: number;
  label: string;
  deep: { level: number };
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const defaults: Options = { size: 1, label: "default", deep: { level: 1 } };

function withDefaults(given: Partial<Options>): Options {
  return { ...defaults, ...given };
}

function assignOver(given: Partial<Options>): Options {
  return Object.assign({ size: 1, label: "default", deep: { level: 1 } }, given);
}

function use(o: Options): string {
  return [o.size + 1, o.size | 0, o.size * 2, typeof o.size, typeof o.label, typeof o.deep].join(" ");
}

function fixed(o: Options): string {
  return o.size.toFixed(1);
}

function upper(o: Options): string {
  return o.label.toUpperCase();
}

function level(o: Options): number {
  return o.deep.level;
}

const givens: [string, Partial<Options>][] = [
  ["nothing", {}],
  ["a size", { size: 5 }],
  ["size is undefined", { size: undefined }],
  ["label is undefined", { label: undefined }],
  ["deep is undefined", { deep: undefined }],
  ["all undefined", { deep: undefined, label: undefined, size: undefined }],
];

for (const [name, given] of givens) {
  for (const [how, merge] of [
    ["spread", withDefaults],
    ["assign", assignOver],
  ] satisfies [string, (given: Partial<Options>) => Options][]) {
    const merged = merge(given);
    console.log(name + ", " + how + ": " + JSON.stringify(merged) + " keys " + Object.keys(merged).join());
    attempt(name + ", " + how + ", arithmetic", () => use(merged));
    attempt(name + ", " + how + ", a method of the number", () => fixed(merged));
    attempt(name + ", " + how + ", a method of the string", () => upper(merged));
    attempt(name + ", " + how + ", a member of the member", () => level(merged));
  }
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += withDefaults({ size: i }).size + level(withDefaults({}));
console.log("2000 honest: " + sum);
attempt("then undefined", () => withDefaults({ size: undefined }).size + 1);
attempt("then undefined, one level down", () => level(withDefaults({ deep: undefined })));

class Widget {
  options: Options;
  constructor(given: Partial<Options>) {
    this.options = { ...defaults, ...given };
  }
  area(): number {
    return this.options.size * this.options.size;
  }
}
console.log("a field: " + new Widget({}).area() + " " + new Widget({ size: 3 }).area() + " " + new Widget({ size: undefined }).area());

const sizes: number[] = givens.map(([, given]) => withDefaults(given).size);
console.log("collected: " + JSON.stringify(sizes) + " " + sizes.map(n => typeof n).join());
console.log("summed: " + sizes.reduce((a, b) => a + b, 0));
console.log("largest: " + Math.max(...sizes));

export {};

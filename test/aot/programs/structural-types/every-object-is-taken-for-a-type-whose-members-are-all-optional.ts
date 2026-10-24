// A type whose members are all optional takes every object: one filled by name, a literal, an empty literal, an array, a Map. Reads, stores, spread, destructuring with defaults, fields and lists of such a type behave as in plain Bun.
interface Options { module?: number; target?: number; strict?: boolean; name?: string; nested?: Options }
interface Loose { [key: string]: unknown; id?: number }
type Some = Partial<{ a: number; b: string }>;
function parse(names: string[]): Options { const options: Record<string, unknown> = {}; for (const name of names) options[name] = 1; return options as Options; }
function target(o: Pick<Options, "module" | "target">): number { return (o.target ?? 0) + (o.module ?? 0); }
function fill(o: Options, i: number): Options { o.target = i; o.name = "n" + i; o.nested = { strict: true }; return o; }
function describe(o: Options): string { return `${o.name}${o.target}${o.strict}${o.nested?.strict}${Object.keys(o).length}`; }
function loose(l: Loose): number { return (l.id ?? 0) + Object.keys(l).length; }
function some(s: Some): string { return (s.a ?? 1) + (s.b ?? "b"); }
function merge(a: Options, b: Options): Options { return { ...a, ...b }; }
function pick({ target = 3, strict }: Options): number { return target + (strict ? 1 : 0); }
class Holder { options: Options = {}; set(o: Options) { this.options = o; return this.options.target ?? -1; } }
function list(all: Options[]): number { let n = 0; for (const o of all) n += o.target ?? 0; return n; }
let n = 0, t = "";
const parsed = parse(["module", "target"]);
const holder = new Holder();
for (let i = 0; i < 100; i++) {
  n += target(parsed) + target({ target: i }) + target({}) + target(new Holder().options) + target([] as Options) + target(new Map() as Options);
  t = describe(fill({}, i)) + describe(fill(parse(["module"]), i)) + describe(merge(parsed, { name: "m" }));
  n += loose({ id: 1, x: 2 }) + loose({}) + loose(parsed as Loose);
  t += some({}) + some({ a: 2 }) + some({ b: "c", a: 3 });
  n += pick(parsed) + pick({ strict: true }) + holder.set(parsed) + holder.set({ target: i }) + list([parsed, {}, { target: 2 }]);
}
console.log(n, t);

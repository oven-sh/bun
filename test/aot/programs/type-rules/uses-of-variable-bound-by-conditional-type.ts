// More places where a variable whose type parameter is bound through a conditional type is read: TypeScript's base constraint of V is `number[] | null`, and the calls below are all well typed.
function show(value: unknown): string { return typeof value + " " + JSON.stringify(value); }
function attempt(label: string, ...runs: (() => unknown)[]): void {
  console.log(label + ": " + runs.map(run => { try { return show(run()); } catch (error) { return "threw " + (error as Error).name; } }).join(" | "));
}
type NoUndefined<T> = T extends undefined ? never : T;
interface Holder<Output = unknown> { _output: Output }
type Output<T> = T extends { _output: any } ? T["_output"] : never;
type Bound<T> = NoUndefined<Output<T>> | number[] | null;
const text: Holder<string> = { _output: "" };
const point: Holder<{ x: number }> = { _output: { x: 1 } };
function field<T extends Holder, V extends Bound<T>>(inner: T, box: { held: V }): string { return show(box.held); }
function element<T extends Holder, V extends Bound<T>>(inner: T, list: V[]): string { return show(list[0]); }
function destructured<T extends Holder, V extends Bound<T>>(inner: T, { held }: { held: V }): string { return show(held); }
function fromTuple<T extends Holder, V extends Bound<T>>(inner: T, [first]: [V]): string { return show(first); }
function iterated<T extends Holder, V extends Bound<T>>(inner: T, list: V[]): string { let out = ""; for (const each of list) out += show(each); return out; }
function local<T extends Holder, V extends Bound<T>>(inner: T, value: V): string { const copy = value; return show(copy); }
function reassigned<T extends Holder, V extends Bound<T>>(inner: T, value: V, other: V): string { let held = value; held = other; return show(held); }
function nonNull<T extends Holder, V extends Bound<T>>(inner: T, value: V): string { return show(value!); }
function chained<T extends Holder, V extends Bound<T>>(inner: T, value: V): string { return show(value?.length); }
function lengthOf<T extends Holder, V extends Bound<T>>(inner: T, value: V): string { return value === null ? "null" : show(value.length); }
function conditional<T extends Holder, V extends Bound<T>>(inner: T, value: V, flag: boolean): string { return show(flag ? value : 0); }
function logical<T extends Holder, V extends Bound<T>>(inner: T, value: V): string { return show(value || "empty"); }
function template<T extends Holder, V extends Bound<T>>(inner: T, value: V): string { return `${value}`; }
function added<T extends Holder, V extends Bound<T>>(inner: T, value: V): string { return "<" + value + ">"; }
function mapped<T extends Holder, V extends Bound<T>>(inner: T, list: V[]): string { return list.map(each => show(each)).join(); }
function callback<T extends Holder, V extends Bound<T>>(inner: T, value: V, use: (given: unknown) => string): string { return use(value); }
function rest<T extends Holder, V extends Bound<T>>(inner: T, ...values: V[]): string { return show(values[0]); }
function defaulted<T extends Holder, V extends Bound<T>>(inner: T, value: V | undefined = undefined): string { return show(value); }
function isArray<T extends Holder, V extends Bound<T>>(inner: T, value: V): string { return Array.isArray(value) ? "array " + value.length : show(value); }
function switched<T extends Holder, V extends Bound<T>>(inner: T, value: V): string { switch (typeof value) { case "string": return "a string"; case "object": return show(value); default: return "other"; } }
async function awaited<T extends Holder, V extends Bound<T>>(inner: T, value: V): Promise<string> { await null; return show(value); }
function* yielded<T extends Holder, V extends Bound<T>>(inner: T, value: V): Generator<unknown> { yield value; }
class Keeper<T extends Holder, V extends Bound<T>> { constructor(public inner: T, public value: V) {} text(): string { return show(this.value); } get held(): unknown { return this.value; } }
attempt("field", () => field(text, { held: "a" }), () => field(text, { held: [1] }), () => field(point, { held: { x: 2 } }));
attempt("element", () => element(text, ["a"]), () => element(point, [{ x: 2 }]));
attempt("destructured", () => destructured(text, { held: "a" }), () => destructured(point, { held: { x: 2 } }));
attempt("fromTuple", () => fromTuple(text, ["a"]), () => fromTuple(point, [{ x: 2 }]));
attempt("iterated", () => iterated(text, ["a"]), () => iterated(point, [{ x: 2 }]));
attempt("local", () => local(text, "a"), () => local(point, { x: 2 }));
attempt("reassigned", () => reassigned(text, "a", "b"), () => reassigned(point, { x: 2 }, null));
attempt("nonNull", () => nonNull(text, "a"), () => nonNull(point, { x: 2 }));
attempt("chained", () => chained(text, "abc"), () => chained(text, [1]), () => chained(text, null), () => chained(point, { x: 2 }));
attempt("lengthOf", () => lengthOf(text, "abc"), () => lengthOf(text, [1]), () => lengthOf(point, { x: 2 }));
attempt("conditional", () => conditional(text, "a", true), () => conditional(point, { x: 2 }, true));
attempt("logical", () => logical(text, "a"), () => logical(text, ""), () => logical(point, { x: 2 }));
attempt("template", () => template(text, "a"), () => template(text, [1, 2]));
attempt("added", () => added(text, "a"), () => added(text, null));
attempt("mapped", () => mapped(text, ["a"]), () => mapped(point, [{ x: 2 }]));
attempt("callback", () => callback(text, "a", show), () => callback(point, { x: 2 }, show));
attempt("rest", () => rest(text, "a"), () => rest(point, { x: 2 }));
attempt("defaulted", () => defaulted(text, "a"), () => defaulted(text), () => defaulted(point, { x: 2 }));
attempt("isArray", () => isArray(text, "a"), () => isArray(text, [1]), () => isArray(point, { x: 2 }));
attempt("switched", () => switched(text, "a"), () => switched(text, [1]), () => switched(point, { x: 2 }));
attempt("yielded", () => [...yielded(text, "a")], () => [...yielded(point, { x: 2 })]);
attempt("class", () => new Keeper(text, "a").text(), () => new Keeper(point, { x: 2 }).text(), () => new Keeper(text, "a").held);
awaited(text, "a").then(got => console.log("awaited: " + got), error => console.log("awaited: threw " + error.name));
awaited(point, { x: 2 }).then(got => console.log("awaited: " + got), error => console.log("awaited: threw " + error.name));

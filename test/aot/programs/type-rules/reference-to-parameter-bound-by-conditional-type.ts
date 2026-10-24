// Where a reference's type is a type parameter whose base constraint is a union, `undefined` or `null`, TypeScript gives the reference the base constraint as its type.
// Through a conditional type that constraint is not a bound on the values: here it is `undefined` or `number[] | null`, and the calls below are all well typed.
interface Schema<Out> { parse(value: unknown): Out }
type Infer<S> = S extends Schema<infer Out> ? Out : never;
interface Tool { inputSchema?: Schema<unknown> }
type ArgumentsOf<T extends Tool> = T["inputSchema"] extends infer S ? (S extends Schema<unknown> ? Infer<S> : undefined) : undefined;
function isObject(value: unknown): boolean { return typeof value === "object" && value !== null; }
function show(value: unknown): string { return typeof value + " " + JSON.stringify(value); }
function attempt(label: string, ...runs: (() => unknown)[]): void {
  console.log(label + ": " + runs.map(run => { try { return show(run()); } catch (error) { return "threw " + (error as Error).name; } }).join(" | "));
}

function passedOn<T extends Tool, A extends ArgumentsOf<T>>(tool: T, given: A): boolean { return isObject(given); }
function stored<T extends Tool, A extends ArgumentsOf<T>>(tool: T, given: A): unknown { const held: unknown = given; return held; }
function returned<T extends Tool, A extends ArgumentsOf<T>>(tool: T, given: A): unknown { return given; }
function compared<T extends Tool, A extends ArgumentsOf<T>>(tool: T, given: A): boolean { return given === undefined; }
function inArray<T extends Tool, A extends ArgumentsOf<T>>(tool: T, given: A): unknown[] { return [given]; }
function inObject<T extends Tool, A extends ArgumentsOf<T>>(tool: T, given: A): { held: unknown } { return { held: given }; }
function kindOf<T extends Tool, A extends ArgumentsOf<T>>(tool: T, given: A): string { return typeof given; }
function asText<T extends Tool, A extends ArgumentsOf<T>>(tool: T, given: A): string { return String(given); }
function serialized<T extends Tool, A extends ArgumentsOf<T>>(tool: T, given: A): string { return JSON.stringify(given) ?? "nothing"; }
function fromField<T extends Tool, A extends ArgumentsOf<T>>(tool: T, box: { held: A }): boolean { return isObject(box.held); }
function fromArray<T extends Tool, A extends ArgumentsOf<T>>(tool: T, list: A[]): boolean { return isObject(list[0]); }
function captured<T extends Tool, A extends ArgumentsOf<T>>(tool: T, given: A): unknown { const read = (): unknown => given; return read(); }
function orElse<T extends Tool, A extends ArgumentsOf<T>>(tool: T, given: A): unknown { return given ?? "none"; }
function tested<T extends Tool, A extends ArgumentsOf<T>>(tool: T, given: A): string { return given ? "truthy" : "falsy"; }
function assigned<T extends Tool, A extends ArgumentsOf<T>>(tool: T, given: A): unknown { let held: unknown; held = given; return held; }
function narrowed<T extends Tool, A extends ArgumentsOf<T>>(tool: T, given: A): string { if (given === undefined) return "undefined"; return show(given); }
class Call<T extends Tool, A extends ArgumentsOf<T>> {
  constructor(public tool: T, public given: A) {}
  check(): boolean { return isObject(this.given); }
  text(): string { return show(this.given); }
}

const tool: Tool = { inputSchema: { parse: (value: unknown) => value } };
const exact = { inputSchema: { parse: (value: unknown) => value as { a: number } } };
const given: Record<string, unknown> | undefined = { a: 1 };
attempt("passedOn", () => passedOn(tool, given), () => passedOn(tool, undefined), () => passedOn(tool, 5), () => passedOn(exact, { a: 2 }), () => passedOn({}, undefined));
attempt("stored", () => stored(tool, given));
attempt("returned", () => returned(tool, given));
attempt("compared", () => compared(tool, given), () => compared(tool, undefined));
attempt("inArray", () => inArray(tool, given));
attempt("inObject", () => inObject(tool, given));
attempt("kindOf", () => kindOf(tool, given), () => kindOf(tool, "s"), () => kindOf(tool, undefined));
attempt("asText", () => asText(tool, 5));
attempt("serialized", () => serialized(tool, given), () => serialized(tool, undefined));
attempt("fromField", () => fromField(tool, { held: given }));
attempt("fromArray", () => fromArray(tool, [given]));
attempt("captured", () => captured(tool, given));
attempt("orElse", () => orElse(tool, given), () => orElse(tool, undefined));
attempt("tested", () => tested(tool, given), () => tested(tool, 0));
attempt("assigned", () => assigned(tool, given));
attempt("narrowed", () => narrowed(tool, given), () => narrowed(tool, undefined), () => narrowed(exact, { a: 3 }));
attempt("check of a class", () => new Call(tool, given).check());
attempt("text of a class", () => new Call(tool, given).text(), () => new Call(tool, undefined).text(), () => new Call(exact, { a: 4 }).text());

type NoUndefined<T> = T extends undefined ? never : T;
interface Holder<Output = unknown> { _output: Output }
type Output<T> = T extends { _output: any } ? T["_output"] : never;
const text: Holder<string> = { _output: "" };
const point: Holder<{ x: number }> = { _output: { x: 1 } };
function unionBound<T extends Holder, V extends NoUndefined<Output<T>> | number[] | null>(inner: T, value: V): string { return show(value); }
function unionBoundStored<T extends Holder, V extends NoUndefined<Output<T>> | number[] | null>(inner: T, value: V): unknown { const held: unknown = value; return held; }
function unionBoundLength<T extends Holder, V extends NoUndefined<Output<T>> | number[]>(inner: T, value: V): unknown { return Array.isArray(value) ? value.length : value; }
function nullBound<T extends Holder, V extends NoUndefined<Output<T>> | null>(inner: T, value: V): string { return show(value); }
attempt("unionBound", () => unionBound(text, "a"), () => unionBound(text, [1]), () => unionBound(text, null), () => unionBound(point, { x: 2 }));
attempt("unionBoundStored", () => unionBoundStored(text, "b"), () => unionBoundStored(point, { x: 3 }));
attempt("unionBoundLength", () => unionBoundLength(text, "c"), () => unionBoundLength(text, [1, 2]), () => unionBoundLength(point, { x: 4 }));
attempt("nullBound", () => nullBound(text, "d"), () => nullBound(text, null), () => nullBound(point, { x: 5 }));

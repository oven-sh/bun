// `JSON.stringify` leaves out a member that holds a function, `undefined` or a symbol, writes `null` for one in an array and answers `undefined` for one at the top, in objects whose serializer is compiled.
// STATISTIC: OwnKeyWalksExpanded >= 10
// STATISTIC: SerializersCreated >= 10
function report(label: string, run: () => unknown) {
  let result: unknown;
  try {
    result = run();
  } catch (error) {
    result = "threw " + (error as Error).name;
  }
  console.log(label, typeof result, String(result));
}

class BoundFirst { onClick = () => 1; id = 1 }
class BoundLast { id = 1; onClick = () => 1 }
class BoundBetween { id = 1; onClick = () => this.id; name = "n"; onHover = (x: number) => x + this.id; price = 9.5 }
class OnlyBound { onClick = () => 1; onHover = () => 2 }
class BoundInConstructor { self: () => BoundInConstructor; id: number; constructor() { this.self = () => this; this.id = 1 } }
class WithMethods { id = 1; method() { return 1 } static helper() { return 2 } get computed() { return 3 } }
class FunctionExpression { run = function () { return 1 }; later = async () => 1; many = function* () { yield 1 }; id = 1 }
function textOfBoundFirst(value: BoundFirst) { return JSON.stringify(value) }
function textOfBoundLast(value: BoundLast) { return JSON.stringify(value) }
function textOfBoundBetween(value: BoundBetween) { return JSON.stringify(value) }
function textOfOnlyBound(value: OnlyBound) { return JSON.stringify(value) }
function textOfBoundInConstructor(value: BoundInConstructor) { return JSON.stringify(value) }
function textOfWithMethods(value: WithMethods) { return JSON.stringify(value) }
function textOfFunctionExpression(value: FunctionExpression) { return JSON.stringify(value) }

interface Handlers { before?: () => void; name: string; after?: (x: number) => number }
class FunctionOrNumber { value: (() => number) | number; id = 1; constructor(round: number) { this.value = round % 2 ? round : () => round } }
class FunctionOrNothing { id = 1; value: (() => number) | undefined | null; constructor(round: number) { this.value = round === 0 ? () => round : round === 1 ? undefined : null } }
class FunctionOrRecord { value: (() => number) | { inner: number; skip: () => void }; constructor(round: number) { this.value = round % 2 ? { inner: round, skip() {} } : () => round } }
class SymbolOrText { tag: symbol | string; id = 1; constructor(round: number) { this.tag = round % 2 ? "text" : Symbol("tag") } }
class Undefineds { a: undefined = undefined; b?: number; c: number | undefined; d = 1; constructor(round: number) { this.c = round % 2 ? round : undefined } }
class Symbols { tag = Symbol("tag"); [Symbol.toStringTag] = "Symbols"; id = 1; last = Symbol.iterator }
class OptionalAbsent { id = 1; note?: string; run?: () => void; constructor(round: number) { if (round === 1) this.note = "n"; if (round === 2) this.run = () => {} } }
function textOfHandlers(value: Handlers) { return JSON.stringify(value) }
function textOfFunctionOrNumber(value: FunctionOrNumber) { return JSON.stringify(value) }
function textOfFunctionOrNothing(value: FunctionOrNothing) { return JSON.stringify(value) }
function textOfFunctionOrRecord(value: FunctionOrRecord) { return JSON.stringify(value) }
function textOfSymbolOrText(value: SymbolOrText) { return JSON.stringify(value) }
function textOfUndefineds(value: Undefineds) { return JSON.stringify(value) }
function textOfSymbols(value: Symbols) { return JSON.stringify(value) }
function textOfOptionalAbsent(value: OptionalAbsent) { return JSON.stringify(value) }

class Base { base = 1; onBase = () => this.base }
class Derived extends Base { derived = 2; onDerived = () => this.derived }
class Holder { inner = new BoundBetween(); empty = new OnlyBound(); list = [new BoundFirst(), new BoundLast()]; id = 1 }
class Lists { handlers: Array<() => number> = [() => 1, () => 2]; mixed: Array<number | (() => number) | undefined | symbol | null> = [1, () => 1, undefined, Symbol("s"), null]; nested = [[() => 1], [2, () => 3]]; id = 1 }
function textOfBaseOrDerived(value: Base) { return JSON.stringify(value) }
function textOfHolder(value: Holder) { return JSON.stringify(value) }
function textOfLists(value: Lists) { return JSON.stringify(value) }
function textOfHandlerList(value: Array<() => number>) { return JSON.stringify(value) }

function withOwnToJSON() { const run = () => 1; (run as unknown as { toJSON: (key: string) => string }).toJSON = key => "function under " + key; return run }
class FunctionWithToJSON { run = withOwnToJSON(); id = 1 }
class ClassWithStaticToJSON { static toJSON(key: string) { return "class under " + key } }
class HoldsClass { type = ClassWithStaticToJSON; plain = Base; id = 1 }
class ToJSONGivesFunction { toJSON() { return () => 1 } }
class ToJSONGivesNothing { toJSON() {} }
class HoldsToJSON { first = new ToJSONGivesFunction(); id = 1; last = new ToJSONGivesNothing() }
class Big { id = 1; big = 1n }
class Boxed { n = new Number(1.5); s = new String("s"); b = new Boolean(false); id = 1 }
class Numbers { nan = NaN; up = Infinity; down = -Infinity; zero = -0; quotient: number; constructor(round: number) { this.quotient = 1 / round } }
function textOfFunctionWithToJSON(value: FunctionWithToJSON) { return JSON.stringify(value) }
function textOfHoldsClass(value: HoldsClass) { return JSON.stringify(value) }
function textOfHoldsToJSON(value: HoldsToJSON) { return JSON.stringify(value) }
function textOfToJSONRoot(value: ToJSONGivesFunction | ToJSONGivesNothing) { return JSON.stringify(value) }
function textOfBig(value: Big) { return JSON.stringify(value) }
function textOfBoxed(value: Boxed) { return JSON.stringify(value) }
function textOfNumbers(value: Numbers) { return JSON.stringify(value) }

function textOfFunction(value: () => number): string { return JSON.stringify(value) }
function textOfFunctionOrInstance(value: (() => number) | BoundFirst | undefined): string { return JSON.stringify(value) }
function textOfSymbol(value: symbol): string { return JSON.stringify(value) }
function textOfNothing(value: undefined): string { return JSON.stringify(value) }
function textOfUnknown(value: unknown): string { return JSON.stringify(value) }

function textWithReplacer(value: BoundBetween) { return JSON.stringify(value, (key, member) => (typeof member === "function" ? "function " + key : member)) }
function textWithList(value: BoundBetween) { return JSON.stringify(value, ["price", "onClick", "id"]) }
function textWithIndent(value: Holder) { return JSON.stringify(value, null, 2) }
function textWithNulls(value: BoundBetween) { return JSON.stringify(value, null, undefined) }

for (let round = 0; round < 3; round++) {
  report("bound first", () => textOfBoundFirst(new BoundFirst()));
  report("bound last", () => textOfBoundLast(new BoundLast()));
  report("bound between", () => textOfBoundBetween(new BoundBetween()));
  report("only bound", () => textOfOnlyBound(new OnlyBound()));
  report("bound in the constructor", () => textOfBoundInConstructor(new BoundInConstructor()));
  report("methods", () => textOfWithMethods(new WithMethods()));
  report("function expressions", () => textOfFunctionExpression(new FunctionExpression()));

  report("interface", () => textOfHandlers(round === 0 ? { name: "none" } : round === 1 ? { before() {}, name: "before" } : { name: "after", after: x => x }));
  report("function or number", () => textOfFunctionOrNumber(new FunctionOrNumber(round)));
  report("function or nothing", () => textOfFunctionOrNothing(new FunctionOrNothing(round)));
  report("function or record", () => textOfFunctionOrRecord(new FunctionOrRecord(round)));
  report("symbol or text", () => textOfSymbolOrText(new SymbolOrText(round)));
  report("undefined", () => textOfUndefineds(new Undefineds(round)));
  report("symbols", () => textOfSymbols(new Symbols()));
  report("optional members", () => textOfOptionalAbsent(new OptionalAbsent(round)));

  report("base or derived", () => textOfBaseOrDerived(round % 2 ? new Base() : new Derived()));
  report("holder", () => textOfHolder(new Holder()));
  report("lists", () => textOfLists(new Lists()));
  report("list of handlers", () => textOfHandlerList([() => 1, () => round]));

  report("function with toJSON", () => textOfFunctionWithToJSON(new FunctionWithToJSON()));
  report("class with static toJSON", () => textOfHoldsClass(new HoldsClass()));
  report("toJSON gives no text", () => textOfHoldsToJSON(new HoldsToJSON()));
  report("toJSON gives no text at the top", () => textOfToJSONRoot(round % 2 ? new ToJSONGivesFunction() : new ToJSONGivesNothing()));
  report("bigint", () => textOfBig(new Big()));
  report("boxed", () => textOfBoxed(new Boxed()));
  report("numbers", () => textOfNumbers(new Numbers(round)));

  report("function at the top", () => textOfFunction(() => round));
  report("function or instance at the top", () => textOfFunctionOrInstance(round === 0 ? () => 1 : round === 1 ? new BoundFirst() : undefined));
  report("symbol at the top", () => textOfSymbol(Symbol("top")));
  report("undefined at the top", () => textOfNothing(undefined));
  report("unknown at the top", () => textOfUnknown(round === 0 ? () => 1 : round === 1 ? new BoundLast() : Symbol("s")));
  report("joined", () => "text: " + textOfFunction(() => 1));

  report("replacer", () => textWithReplacer(new BoundBetween()));
  report("list of keys", () => textWithList(new BoundBetween()));
  report("indent", () => textWithIndent(new Holder()));
  report("null replacer", () => textWithNulls(new BoundBetween()));
}

const responses = [Response.json(new BoundBetween()), Response.json(new Holder()), Response.json([() => 1, new OnlyBound()])];
for (const response of responses) console.log("response", await response.text());

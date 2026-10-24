// A generic overload over an implementation that is typed with `unknown`. The record type is invariant in its type parameter: the parameter
// stands in a parameter of a function-typed property. So the record that the implementation makes is neither a subtype nor a supertype of
// the record type that the call expects, and it cannot become that type in place: its method reads `this`.
const say = (label: string, f: () => unknown): void => { let r: string; try { r = String(f()); } catch (e) { r = "throws " + (e as Error).name; } console.log(label + " ==> " + r); };

interface Counter<T> { value: T; readonly set: (next: T) => void }
function counter<T>(value: T): Counter<T>;
function counter(value: unknown): Counter<unknown> { return { value, set(next) { this.value = next; } }; }
const writtenCounter: Counter<number> = { value: 1, set: next => {} };
say("a primitive parameter, and no other use of the type", () => { const count = counter(0); count.set(41); return count.value + 1 + writtenCounter.value; });

interface Store<T> { value: T; readonly set: (next: T) => void }
function store<T>(value: T): Store<T>;
function store(value: unknown): Store<unknown> { return { value, set(next) { this.value = next; } }; }
const written: Store<number> = { value: 1, set: next => {} };
const writtenText: Store<string> = { value: "w", set: next => {} };
const read = (from: Store<number>) => from.value + 1;
class Holder { held: Store<number> = written; }

say("a primitive parameter", () => { const count = store(0); count.set(41); return count.value + 1 + written.value; });
say("type arguments are written", () => { const count = store<number>(0); count.set(41); return count.value + 1; });
say("two instantiations", () => { const count = store(1); const text = store("a"); text.set("b"); return count.value + 1 + text.value + writtenText.value; });
say("it stays one object", () => { const count = store(0); const same: Store<number> = count; same.set(5); return (count === same) + " " + count.value; });
say("passed to a function", () => read(store(1)) + read(written));
say("each store keeps its own method", () => { const all: Store<number>[] = [store(1), written, store(2)]; for (const each of all) each.set(9); return all.map(each => each.value).join(); });
say("in an array", () => { const all: Store<number>[] = [store(1), written, store(2)]; let sum = 0; for (const each of all) sum += each.value; return sum; });
say("in a field", () => { const holder = new Holder(); holder.held = store(6); holder.held.set(7); return holder.held.value + 1; });
say("its keys", () => Object.keys(store(0)).join());

interface Fold<Out> { readonly run: (box: { value: Out }) => boolean; readonly initial: Out }
function fold<Out>(initial: Out): Fold<Out>;
function fold(initial: unknown): Fold<unknown> { return { initial, run(box) { return box.value === this.initial; } }; }
const other = { initial: 0, run: box => box.value === 100 } satisfies Fold<number>;

say("a record parameter", () => { const step = fold<number>(0); return step.initial + 1 + " " + other.run({ value: 1 }); });
say("the method is called with a record", () => { const step = fold<number>(0); return step.run({ value: 0 }) + " " + step.run({ value: 1 }); });
say("each record keeps its own method", () => { const both: Fold<number>[] = [fold<number>(0), other, fold<number>(100)]; return both.map(each => each.run({ value: 0 }) + "" + each.run({ value: 100 })).join(); });

interface Cell<T> { value: T; readonly set: (next: T) => void }
function cell<T>(value: T): Cell<T> { return { value, set(next) { this.value = next; } }; }
const writtenCell: Cell<number> = { value: 1, set: next => {} };
say("one signature, nothing unverified", () => { const count = cell(0); count.set(41); return count.value + 1 + writtenCell.value; });

interface Rule<T, M extends string | undefined> { value: T; readonly message: M; readonly set: (next: T) => void }
function rule<T>(value: T): Rule<T, undefined>;
function rule<T, const M extends string | undefined>(value: T, message: M): Rule<T, M>;
function rule(value: unknown, message?: string): Rule<unknown, string | undefined> { return { value, message, set(next) { this.value = next; } }; }
const writtenRule: Rule<number, undefined> = { value: 1, message: undefined, set: next => {} };
say("the overload promises undefined where the implementation says string or undefined", () => { const count = rule(0); count.set(41); return count.value + 1 + " " + count.message + " " + writtenRule.value; });
say("the overload promises a literal where the implementation says string or undefined", () => { const count = rule(0, "m"); count.set(41); return count.value + 1 + count.message; });

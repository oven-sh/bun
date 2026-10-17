// A computed key that a constant string names is a name like any other: the literal is what it would be with the name written out.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
const TypeId = "~scope/TypeId";
const Kind = "kind" as const;
const Zero = "0";
const Proto = "__proto__";
interface Scope { readonly [TypeId]: typeof TypeId; readonly [Kind]: string; size: number; parent: Scope | undefined }
const make = (size: number, parent: Scope | undefined): Scope => ({ [TypeId]: TypeId, [Kind]: "scope", size, parent });
const show = (value: object): string => JSON.stringify(value) + " " + Object.keys(value).join();
row("made", () => show(make(1, undefined)));
row("read by the constant", () => make(1, undefined)[TypeId] + " " + make(2, undefined)[Kind]);
row("read by the name", () => make(1, undefined).kind + " " + make(3, make(4, undefined)).parent!.size);
row("in", () => (TypeId in make(1, undefined)) + " " + ("kind" in make(1, undefined)));
row("a string written in brackets", () => show({ ["written"]: 1, after: 2 }));
row("the order of keys", () => show({ last: 1, [Kind]: 2, [TypeId]: 3, first: 4 }));
row("a numeric string", () => show({ b: 1, [Zero]: 2, a: 3 }));
row("__proto__ in brackets is a property", () => { const made = { [Proto]: { inherited: 1 }, own: 2 }; return show(made) + " " + (Object.getPrototypeOf(made) === Object.prototype) + " " + ("inherited" in made) });
row("a function takes the name", () => { const made = { [Kind]: function () {}, [TypeId]: () => 1 }; return made[Kind].name + " | " + made[TypeId].name });
row("a constant read before it is set", () => { const made = { [Later]: 1 }; return show(made) });
const Later = "later";
row("and after", () => show({ [Later]: 1 }));
row("values are evaluated in order", () => { const seen: string[] = []; const note = (text: string): string => { seen.push(text); return text }; const made = { a: note("a"), [Kind]: note("kind"), z: note("z") }; return seen.join() + " " + show(made) });
row("with a spread", () => show({ ...make(1, undefined), [Kind]: "other" }));
row("a let is no constant", () => { let key = "one"; const made = { [key]: 1 }; key = "two"; return show(made) + " " + show({ [key]: 2 }) });

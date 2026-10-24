// A generic function returns a record that holds another record, both created at the function's own type parameters. The caller reads the inner record through the result's type at the caller's type arguments: it fits, so it is accepted.
const row = (name: string, f: () => unknown) => { let r: unknown; try { r = JSON.stringify(f()); } catch (e) { r = "THROWS " + (e as Error).message.split(" (bun")[0].split("\n")[0]; } console.log(name + ": " + r); };
const throws = (name: string, f: () => unknown) => { let r = "returns"; try { f(); } catch { r = "throws"; } console.log(name + ": " + r); };

type Served<Cause, Result> = { readonly cause: Cause; readonly result: Result; readonly number: number };
type NearCause = "send" | "poll";
type NearResult = "status" | "not_found";
type NearServed = Served<NearCause, NearResult>;
type FarServed = Served<"turn" | "timer", number>;

function direct<C, R>(cause: C, result: R): Served<C, R> { return { cause, result, number: 1 }; }
function nested<C, R>(cause: C, result: R): { served: Served<C, R>; n: number } { return { served: { cause, result, number: 2 }, n: 0 }; }
function twice<C, R>(cause: C, result: R): { outer: { served: Served<C, R> } } { return { outer: { served: { cause, result, number: 3 } } }; }
function optional<C, R>(cause: C, result: R): { served?: Served<C, R> | null } { return { served: { cause, result, number: 4 } }; }
function both<C, R>(cause: C, result: R): { first: Served<C, R>; second: Served<R, C> } { return { first: { cause, result, number: 5 }, second: { cause: result, result: cause, number: 6 } }; }
function kept<C, R>(cause: C, result: R) { const served: Served<C, R> = { cause, result, number: 7 }; return { served, again: () => served.cause, same: (other: unknown) => other === served }; }
function listed<C, R>(cause: C, result: R): { all: Served<C, R>[] } { return { all: [{ cause, result, number: 8 }] }; }

const arrow = <C, R>(cause: C, result: R): { served: Served<C, R> } => ({ served: { cause, result, number: 9 } });
function bounded<C extends string, R extends string>(cause: C, result: R): { served: Served<C, R> } { return { served: { cause, result, number: 10 } }; }
function called<C, R>(cause: C, result: R, then: (u: { served: Served<C, R> }) => string): string { return then({ served: { cause, result, number: 11 } }); }
function inElements<C, R>(cause: C, result: R): { all: { served: Served<C, R> }[] } { return { all: [{ served: { cause, result, number: 12 } }] }; }
function* each<C, R>(cause: C, result: R): Generator<{ served: Served<C, R> }> { yield { served: { cause, result, number: 13 } }; }
function fill<C, R>(into: { served: Served<C, R> | null }, cause: C, result: R) { into.served = { cause, result, number: 14 }; }
async function later<C, R>(cause: C, result: R): Promise<{ served: Served<C, R> }> { await 0; return { served: { cause, result, number: 15 } }; }
class Keeper { kept: { served: NearServed; n: number } | null = null; }
const use = (s: NearServed) => s.cause.toUpperCase() + s.result.length + s.number;
const useFar = (s: FarServed) => s.cause.length + s.result + s.number;
const hold = (s: NearServed): { read: NearServed } => ({ read: s });
const handedOn = (u: { served: NearServed; n: number }) => use(u.served) + u.n;

row("the result itself", () => use(direct<NearCause, NearResult>("poll", "status")));
row("a member of the result", () => use(nested<NearCause, NearResult>("poll", "status").served));
row("laid into a literal under a written type", () => { const u = nested<NearCause, NearResult>("poll", "status"); const made: { read: NearServed; n: number } = { read: u.served, n: u.n }; return made; });
row("destructured", () => { const { served } = nested<NearCause, NearResult>("send", "not_found"); return hold(served); });
row("two members deep", () => use(twice<NearCause, NearResult>("poll", "status").outer.served));
row("an optional member", () => use(optional<NearCause, NearResult>("poll", "status").served!));
row("type arguments that are inferred", () => { const cause: NearCause = "send"; const result: NearResult = "status"; return use(nested(cause, result).served); });
row("the same function at other type arguments", () => useFar(nested<"turn" | "timer", number>("timer", 40).served));
row("two members at swapped type arguments", () => { const b = both<NearCause, NearResult>("poll", "status"); return [use(b.first), b.second.cause.length + b.second.result.length]; });
row("the result is handed on first", () => handedOn(nested<NearCause, NearResult>("send", "status")));
row("read twice: one object", () => { const u = nested<NearCause, NearResult>("poll", "status"); const a: NearServed = u.served; const b: NearServed = u.served; return a === b; });
row("the generic function still reads it", () => { const k = kept<NearCause, NearResult>("poll", "status"); const s: NearServed = k.served; return [use(s), k.again(), k.same(s)]; });
row("an element of a member", () => use(listed<NearCause, NearResult>("poll", "status").all[0]));
row("inside try", () => { try { return use(nested<NearCause, NearResult>("poll", "status").served); } catch { return "caught"; } });
row("a generic arrow function", () => use(arrow<NearCause, NearResult>("poll", "status").served));
row("type parameters with bounds", () => use(bounded<NearCause, NearResult>("poll", "status").served));
row("handed to a callback", () => called<NearCause, NearResult>("poll", "status", u => use(u.served)));
row("inside an element of an array", () => use(inElements<NearCause, NearResult>("poll", "status").all[0].served));
row("the result is spread", () => { const u = { ...nested<NearCause, NearResult>("poll", "status"), n: 1 }; return use(u.served); });
row("the result is stored in a field", () => { const k = new Keeper(); k.kept = nested<NearCause, NearResult>("poll", "status"); return use(k.kept.served); });
row("yielded by a generator", () => { for (const u of each<NearCause, NearResult>("poll", "status")) return use(u.served); });
row("stored into an object of the caller", () => { const into: { served: NearServed | null } = { served: null }; fill(into, "poll" as NearCause, "status" as NearResult); return use(into.served!); });
const awaited = await later<NearCause, NearResult>("poll", "status");
row("awaited", () => use(awaited.served));
throws("a cause of another kind, through any", () => use(nested<NearCause, NearResult>(5 as any, "status").served));

let sum = 0;
for (let i = 0; i < 20000; i++) {
  sum += i % 2 ? use(nested<NearCause, NearResult>(i % 4 === 1 ? "poll" : "send", "status").served).length : useFar(nested<"turn" | "timer", number>("turn", i).served);
}
row("many times, the type arguments taking turns", () => sum);

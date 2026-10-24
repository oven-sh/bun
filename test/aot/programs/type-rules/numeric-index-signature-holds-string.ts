// A string is assignable to `{ [index: number]: string }`: its apparent type `String` has that index signature.
declare const console: { log(...a: unknown[]): void };
type Characters = { [index: number]: string };
function parameter(value: Characters): unknown { return value; }
function first(value: Characters): string { return value[0]; }
function orNull(value: Characters | null): unknown { return value; }
function optional(value?: { readonly [index: number]: string }): unknown { return value; }
function inField(holder: { held: Characters }): unknown { return holder.held; }
function returned(): Characters { return "returned"; }
function local(value: Characters): unknown { let kept: Characters | undefined; kept = value; const list: Characters[] = []; list.push(kept); return list[0]; }
function callback(make: () => Characters): unknown { const made: Characters = make(); return made; }
class Holder { held: Characters; constructor(held: Characters) { this.held = held; } get(): Characters { return this.held; } }
let kept: Characters = "kept";
const table = new Map<string, Characters>();
const given: any = "given";
console.log(parameter("str"), first("str"), first(["a"]), first({ 0: "zero" }), orNull("str"), orNull(null), optional("str"), optional(), inField({ held: "str" }));
console.log(returned(), local("str"), callback(() => "str"), new Holder("str").get(), kept, table.set("k", "str").get("k"), parameter(given), JSON.stringify([parameter(["a"]), parameter({ 0: "a" }), parameter({})]));

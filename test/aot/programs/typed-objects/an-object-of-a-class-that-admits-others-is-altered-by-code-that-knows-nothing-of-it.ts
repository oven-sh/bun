// State also admits objects from elsewhere: a value of which nothing is known is held to it. Code that knows nothing of the class then does to one of its objects what
// the language allows: a value of another kind in a field, a field removed, an accessor over a field, another prototype, a frozen object. That one object is an ordinary
// object from then on. It stays the same object, and typed code goes on reading and storing through it whatever still is what the class says.
declare const console: { log(...values: unknown[]): void };
declare const globalThis: any;
class State {
  length: number;
  mark: number;
  list: unknown[];
  held: unknown;
  flags: number;
  constructor(length: number) {
    this.length = length;
    this.mark = 16;
    this.list = [];
    this.held = null;
    this.flags = 5;
  }
  get ended(): boolean { return (this.flags & 4) !== 0; }
  set ended(value: unknown) { if (value) this.flags |= 4; else this.flags &= ~4; }
  doubled(): number { return this.flags * 2; }
}
interface Holder { state: any }
function hold(length: number): Holder { const holder: any = {}; holder.state = new State(length); return holder; }
function stateOf(holder: Holder): State { const state: State = holder.state; return state; }

function length(state: State): string { return typeof state.length + " " + state.length; }
function mark(state: State): string { return typeof state.mark + " " + state.mark; }
function list(state: State): string { return String(state.list.length); }
function flags(state: State): string { return state.flags + " " + state.ended + " " + state.doubled(); }
function held(state: State): string { return String(state.held); }
function bumpLength(state: State): void { state.length += 2; }
function bumpMark(state: State): void { state.mark = state.mark + 1; }
function bumpFlags(state: State): void { state.flags |= 8; state.ended = false; }
function bumpHeld(state: State): void { state.held = "held"; }
function aroundFlags(state: State, between: () => void): string { const before = state.flags; between(); return before + " then " + state.flags + " " + state.ended; }
function aroundHeld(state: State, between: () => void): string { const before = String(state.held); between(); return before + " then " + String(state.held); }

const L = 1, M = 2, I = 4, F = 8, H = 16, ALL = 31;
const deeds: [string, number, (x: any) => unknown][] = [
  ["nothing", ALL, x => x],
  ["a string in a number's field", ALL & ~L, x => { x.length = "5"; }],
  ["undefined in a number's field", ALL & ~M, x => { x.mark = undefined; }],
  ["null in an array's field", ALL & ~I, x => { x.list = null; }],
  ["an object in an array's field", ALL & ~I, x => { x.list = { length: 0 }; }],
  ["a field that holds anything removed", ALL, x => { delete x.held; }],
  ["a number's field removed", ALL & ~L, x => { delete x.length; }],
  ["removed and stored again", ALL, x => { delete x.length; x.length = 7; }],
  ["an accessor over a field", ALL, x => { let reads = 0; Object.defineProperty(x, "length", { get() { reads++; return 40 + reads; }, set() {}, configurable: true }); }],
  ["a field made read-only", ALL & ~M, x => { Object.defineProperty(x, "mark", { value: 5, writable: false }); }],
  ["a field hidden", ALL, x => { Object.defineProperty(x, "mark", { enumerable: false }); }],
  ["sealed", ALL, x => { Object.seal(x); }],
  ["not extensible", ALL, x => { Object.preventExtensions(x); }],
  ["an heir of the prototype for a prototype", ALL, x => { Object.setPrototypeOf(x, Object.create(State.prototype, { hello: { value: 1 } })); }],
  ["more properties", ALL, x => { x.more = 1; x[0] = "zero"; x[Symbol.for("s")] = 2; }],
];
globalThis.kept = [length, mark, list, flags, held, bumpLength, bumpMark, bumpFlags, bumpHeld, aroundFlags, aroundHeld, stateOf, hold];
function attempt(f: () => unknown): string { try { return String(f()); } catch (e) { return "THROWS " + (e as any).name; } }
function describe(state: State, which: number): string {
  return [which & L ? length(state) : "-", which & M ? mark(state) : "-", which & I ? list(state) : "-", which & F ? flags(state) : "-", which & H ? held(state) : "-"].join(" . ");
}
function bump(state: State, which: number): void {
  if (which & L) bumpLength(state);
  if (which & M) bumpMark(state);
  if (which & F) bumpFlags(state);
  if (which & H) bumpHeld(state);
}
function look(x: any): string {
  return [Reflect.ownKeys(x).map(String).join(), JSON.stringify(Object.getOwnPropertyDescriptor(x, "length")), JSON.stringify(Object.getOwnPropertyDescriptor(x, "mark")), String(x.length), String(x.mark), String(x.list), String(x.flags), String(x.ended),
    String(x instanceof State), String(Object.isFrozen(x)), String(Object.isSealed(x)), String(Object.isExtensible(x)), String("held" in x), String(x.hello), JSON.stringify(x)].join(" | ");
}
for (const [name, which, deed] of deeds) {
  const holder = hold(3);
  const same = holder.state;
  const keyed = new Map<unknown, string>([[same, "found"]]);
  console.log(name + ": the deed: " + attempt(() => (deed(holder.state), "done")));
  console.log(name + ": read: " + attempt(() => describe(stateOf(holder), which)));
  console.log(name + ": stored: " + attempt(() => (bump(stateOf(holder), which), describe(stateOf(holder), which))));
  console.log(name + ": from outside: " + attempt(() => look(holder.state)));
  console.log(name + ": the same object: " + (same === holder.state && same === stateOf(holder)) + " " + keyed.get(stateOf(holder)));
  const second = hold(9);
  console.log(name + ": in the middle: " + attempt(() => aroundFlags(stateOf(second), () => { deed(second.state); })) + " . " + attempt(() => aroundHeld(stateOf(second), () => { second.state.held = name.length; })));
  console.log(name + ": afterwards: " + attempt(() => describe(stateOf(second), which)));
}
const frozen = hold(3);
Object.freeze(frozen.state);
console.log("frozen: " + attempt(() => describe(stateOf(frozen), ALL)) + " | " + attempt(() => bumpFlags(stateOf(frozen))) + " | " + attempt(() => bumpLength(stateOf(frozen))) + " | " + look(frozen.state));
const many: Holder[] = [];
for (let i = 0; i < 300; i++) many.push(hold(i));
for (let i = 0; i < 300; i += 3) deeds[1 + (i % (deeds.length - 1))][2](many[i].state);
let sum = 0;
for (let turn = 0; turn < 3; turn++) for (let i = 0; i < 300; i++) { const state = stateOf(many[i]); bumpFlags(state); sum += state.flags + (state.ended ? 1 : 0); }
console.log(sum);

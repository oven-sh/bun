// A store by name, by code that knows nothing of the receiver, that reaches a setter of a class whose objects are laid out: the run time is asked a few times for each
// class of receiver, not at every store. What was learnt ends when the object or a prototype changes.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
declare const console: { log(...values: unknown[]): void };
declare const globalThis: any;
const count: (name: string) => unknown = typeof globalThis.aotOperationCount === "function" ? globalThis.aotOperationCount : () => 0;
function attempt(f: () => unknown): string { try { return String(f()); } catch (error) { return (error as any).constructor.name + ": " + (error as any).message; } }
class State {
  flags: number;
  length: number;
  constructor() { this.flags = 0; this.length = 0; }
  get more(): boolean { return (this.flags & 4) !== 0; }
  set more(value: unknown) { if (value) this.flags |= 4; else this.flags &= ~4; }
  set size(value: number) { this.length = value; }
  get fixed(): number { return 7; }
  set failing(value: unknown) { throw new RangeError("refused " + String(value)); }
}
class Wider extends State {
  extra: number;
  constructor() { super(); this.extra = 1; }
  set more(value: unknown) { this.extra = value ? 2 : 3; }
  get more(): boolean { return this.extra === 2; }
}
class Widest extends Wider {
  last: string;
  constructor() { super(); this.last = "last"; }
}
function setMore(x: any, turns: number): void { for (let i = 0; i < turns; i++) x.more = (i & 1) === 0; }
function setSize(x: any, turns: number): void { for (let i = 0; i < turns; i++) x.size = i; }
function setFixed(x: any, value: unknown): void { x.fixed = value; }
function setFailing(x: any, value: unknown): void { x.failing = value; }
function look(x: any): string { return [x.flags, x.length, x.more, x.extra, x.fixed].join(); }
globalThis.kept = [setMore, setSize, setFixed, setFailing, look];
const asked = (): number => Number(count("operationAOTPutByIdAndCache")) || 0;
const receivers: any[] = [new State(), new Wider(), new Widest()];
let most = 0;
for (const store of [setMore, setSize]) {
  for (const receiver of receivers) {
    const before = asked();
    store(receiver, 501);
    most = Math.max(most, asked() - before);
  }
}
console.log(most <= 8 ? "no setter was asked of the run time more than eight times" : "the run time was asked " + most + " times for one setter of one class");
console.log(receivers.map(look).join(" | "));
console.log(attempt(() => setFixed(receivers[0], 1)), attempt(() => setFixed(receivers[2], 1)), look(receivers[0]));
for (let i = 0; i < 12; i++) console.log(attempt(() => setFailing(receivers[i % 3], i)));

const shadowed: any = new State();
setMore(shadowed, 21);
console.log(look(shadowed));
console.log(attempt(() => Object.defineProperty(shadowed, "size", { value: "own", writable: true, configurable: true, enumerable: true })) === "[object Object]" ? "defined" : "refused");
setSize(shadowed, 3);
console.log(look(shadowed), attempt(() => shadowed.size));
const plain: any = { flags: 0, length: 0 };
Object.setPrototypeOf(plain, State.prototype);
setMore(plain, 21); setSize(plain, 21);
console.log(look(plain), Object.keys(plain).join());
const heir: any = Object.create(receivers[0]);
setMore(heir, 20); setSize(heir, 20);
console.log(look(heir), Object.keys(heir).join(), look(receivers[0]));
console.log(attempt(() => setMore(5, 3)), attempt(() => setMore("text", 3)), attempt(() => setMore(true, 3)));
console.log(attempt(() => setMore(null, 1)).split(":")[0], attempt(() => setMore(undefined, 1)).split(":")[0]);

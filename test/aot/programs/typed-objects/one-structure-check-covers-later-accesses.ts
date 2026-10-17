// A read or a store through a type that also admits objects from elsewhere tests the shape of the receiver. One test covers the accesses to that receiver that follow it, until something
// runs that could change what the object is: a call, a conversion that runs valueOf or toString, a getter of another object, a store that changes a discriminant.
// An object from elsewhere, `undefined` and `null` fail the test and are served as they always were.
interface Point { x: number; y: number; z: number; w: number }
function make(i: number): Point { return { x: i + 0.5, y: i + 1.5, z: i + 2.5, w: i + 3.5 } }
let log: string[] = [];
let onRead: (name: string) => void = () => {};
function elsewhere(i: number): Point {
  const made: any = {};
  for (const name of ["x", "y", "z", "w"]) {
    let held = i + name.charCodeAt(0) + 0.25;
    Object.defineProperty(made, name, { get() { log.push("get " + name); onRead(name); return held }, set(v) { log.push("set " + name); held = v }, enumerable: true, configurable: true });
  }
  return made;
}
type Change = (o: any) => void;
const changes: Change[] = [
  () => {},
  o => { o.y = "text"; o.x = 55.5 },
  o => { delete o.x; o.x = 66.5 },
  o => { Object.defineProperty(o, "x", { get() { return 77.5 }, configurable: true }) },
  o => { delete o.x; Object.setPrototypeOf(o, { x: 88.5 }) },
  o => { Object.freeze(o) },
];
const changeNames = ["nothing", "a string in a number's place", "deleted and stored again", "an accessor", "another prototype", "frozen"];

function fourReads(o: Point): number { return o.x + o.y + o.z + o.w }
function fourStores(o: Point, n: number): void { o.x = n; o.y = n + 1; o.z = n + 2; o.w = n + 3 }
function twoReceivers(o: Point, p: Point): number { return o.x + p.x + o.y + p.y }
function inBranches(o: Point, c: boolean): number { let s = o.x; if (c) s += o.y; else s += o.z; return s + o.w }
function inLoop(o: Point, n: number): number { let s = 0; for (let i = 0; i < n; i++) s += o.x + o.y; return s }
function aroundCall(o: Point, f: Change): string { const before = o.w; f(o); return before + " " + o.w + " " + o.z + " " + o.x }
function aroundAddition(o: Point, v: any): string { const before = o.w; const sum = 1 + v; return before + " " + sum + " " + o.w + " " + o.x }
function aroundTemplate(o: Point, v: any): string { const before = o.w; const text = `${v}`; return before + " " + text + " " + o.w + " " + o.x }
function aroundOtherReceiver(o: Point, p: Point): string { return o.w + " " + p.y + " " + o.w + " " + o.z + " " + o.x }
function callInLoop(o: Point, f: Change): string { let s = ""; for (let i = 0; i < 3; i++) { s += o.w + "," + o.x + ";"; if (i === 1) f(o) } return s }
function storeThenCall(o: Point, f: Change): string { o.z = 7.5; f(o); o.z = 8.5; return o.z + " " + o.w + " " + o.x }
function ofNothing(o: Point | null | undefined): number { return o!.x + o!.y }
// What follows the covered accesses needs its constants as constants, and an object that is being made stays one object.
function beforePattern(o: Point, text: string): string { const w = o.w; return w + " " + /a+b/gi.test(text) + " " + text.replace(/b/g, "c") + " " + o.z }
function whileMaking(o: Point, f: Change): { first: number; second: number; third: unknown; fourth: number } { const first = o.w; return { first, second: o.z, third: f(o), fourth: o.w } }
const kept = [fourReads, fourStores, twoReceivers, inBranches, inLoop, aroundCall, aroundAddition, aroundTemplate, aroundOtherReceiver, callInLoop, storeThenCall, ofNothing, beforePattern, whileMaking];
(globalThis as { kept?: unknown }).kept = kept;

const lines: string[] = [];
function say(what: string, run: () => unknown): void {
  log = [];
  let said: string;
  try { said = String(run()) } catch (e) { said = "throws " + (e as Error).name }
  lines.push(what + ": " + said + (log.length ? " [" + log.join(" ") + "]" : ""));
}
const byTable: { [name: string]: (...rest: any[]) => unknown } = { fourReads, fourStores, twoReceivers, inBranches, inLoop, aroundCall, aroundAddition, aroundTemplate, aroundOtherReceiver, callInLoop, storeThenCall, ofNothing };

for (let turn = 0; turn < 3; turn++) {
  // Records alone.
  lines.push("records " + fourReads(make(turn)) + " " + twoReceivers(make(turn), make(turn + 1)) + " " + inBranches(make(turn), turn === 1) + " " + inLoop(make(turn), 4));
  const stored = make(turn); fourStores(stored, turn + 0.25); lines.push("stored " + stored.x + " " + stored.y + " " + stored.z + " " + stored.w);
  // Objects from elsewhere: every getter and setter runs once, in order.
  say("elsewhere, four reads", () => fourReads(elsewhere(turn)));
  say("elsewhere, four stores", () => { const o = elsewhere(turn); fourStores(o, turn); return fourReads(o) });
  say("elsewhere first", () => twoReceivers(elsewhere(turn), make(turn)));
  say("elsewhere second", () => twoReceivers(make(turn), elsewhere(turn)));
  say("elsewhere both", () => twoReceivers(elsewhere(turn), elsewhere(turn + 1)));
  say("elsewhere, in branches", () => inBranches(elsewhere(turn), turn === 1));
  say("elsewhere, in a loop", () => inLoop(elsewhere(turn), 2));
  say("null", () => ofNothing(null));
  say("undefined", () => ofNothing(undefined));
  say("a record where nothing may come", () => ofNothing(make(turn)));
  say("before a pattern", () => beforePattern(make(turn), "xaab") + " | " + beforePattern(elsewhere(turn), "b"));
  for (let k = 0; k < changes.length; k++) {
    const change = changes[k], name = changeNames[k];
    say(name + ", around a call", () => aroundCall(make(turn), change));
    say(name + ", a call in a loop", () => callInLoop(make(turn), change));
    say(name + ", a store, then a call", () => storeThenCall(make(turn), change));
    say(name + ", around an addition", () => { const o = make(turn); return aroundAddition(o, { valueOf() { change(o); return 1 } }) });
    say(name + ", around a template", () => { const o = make(turn); return aroundTemplate(o, { toString() { change(o); return "t" } }) });
    say(name + ", around a getter of another object", () => { const o = make(turn); onRead = () => { onRead = () => {}; change(o) }; return aroundOtherReceiver(o, elsewhere(turn)) });
    onRead = () => {};
    say(name + ", while an object is made", () => JSON.stringify(whileMaking(make(turn), change)));
    say(name + ", around a call, by the table", () => byTable.aroundCall(make(turn), change));
    say(name + ", a call in a loop, by the table", () => byTable.callInLoop(make(turn), change));
    say(name + ", a store, then a call, by the table", () => byTable.storeThenCall(make(turn), change));
    say(name + ", around an addition, by the table", () => { const o = make(turn); return byTable.aroundAddition(o, { valueOf() { change(o); return 1 } }) });
    say(name + ", around a template, by the table", () => { const o = make(turn); return byTable.aroundTemplate(o, { toString() { change(o); return "t" } }) });
    say(name + ", around a getter of another object, by the table", () => { const o = make(turn); onRead = () => { onRead = () => {}; change(o) }; return byTable.aroundOtherReceiver(o, elsewhere(turn)) });
    onRead = () => {};
  }
}
console.log(lines.join("\n"));

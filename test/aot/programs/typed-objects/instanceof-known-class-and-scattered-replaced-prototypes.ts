// The records whose prototype may be replaced cannot get consecutive shape numbers here: First and Third are marked, and Second must lie between them, because First | Second and Second | Third are both tested often. `v instanceof Known` still follows the prototype of each. The guard reads `kind` through `as Second`, where it is written "second": for a Third, Fourth or Fifth that typed read gives their own text.
class Known {
  x = 1;
}
class Other {
  z = 3;
}
interface First {
  kind: "first";
  a: number;
}
interface Second {
  kind: "second";
  b: number;
}
interface Third {
  kind: "third";
  c: number;
}
interface Fourth {
  kind: "fourth";
  d: number;
}
interface Fifth {
  kind: "fifth";
  e: number;
}
const first = (n: number): First => ({ kind: "first", a: n });
const second = (n: number): Second => ({ kind: "second", b: n });
const third = (n: number): Third => ({ kind: "third", c: n });
const fourth = (n: number): Fourth => ({ kind: "fourth", d: n });
const fifth = (n: number): Fifth => ({ kind: "fifth", e: n });
function alter(record: First | Third | Fifth, parent: object | null) {
  Object.setPrototypeOf(record, parent);
}
const isFirstOrSecond = (v: unknown): v is First | Second => (v as First | Second | Third | Fourth | Fifth).kind === "first" || (v as Second).kind === "second";
function low(v: First | Second): number {
  return v.kind === "first" ? v.a : v.b;
}
function middle(v: Second | Third): number {
  return v.kind === "second" ? v.b : v.c;
}
function high(v: Third | Fourth): number {
  return v.kind === "third" ? v.c : v.d;
}
function top(v: Fourth | Fifth): number {
  return v.kind === "fourth" ? v.d : v.e;
}
const pairs: any[] = [first(1), second(2), third(3), fourth(4), fifth(5)];
let sum = 0;
for (let turn = 0; turn < 50; turn++) {
  sum += low(pairs[turn & 1] as First | Second) + middle(pairs[1 + (turn & 1)] as Second | Third) + high(pairs[2 + (turn & 1)] as Third | Fourth) + top(pairs[3 + (turn & 1)] as Fourth | Fifth);
  try { if (isFirstOrSecond(pairs[turn % 5])) sum++; } catch (e) { console.log("guard", turn % 5, (e as Error).constructor.name); }
}
console.log("sum", sum);
const isKnown = [(v: any) => v instanceof Known][0]!;
const isOther = [(v: any) => v instanceof Other][0]!;
function inLoop(values: any[]) {
  let known = 0, other = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] instanceof Known) known++;
    if (values[i] instanceof Other) other++;
  }
  return known + "/" + other;
}
const show = (values: any[]) => values.map(v => (isKnown(v) ? "K" : isOther(v) ? "O" : "-")).join("");
const made = () => [first(1), second(2), third(3), fourth(4), fifth(5), new Known(), new Other(), JSON.parse("{}"), "text", 7, null] as any[];
let values = made();
console.log("as made", show(values), inLoop(values));
alter(values[0], Known.prototype);
console.log("first", show(values), inLoop(values));
alter(values[2], Other.prototype);
console.log("third", show(values), inLoop(values));
alter(values[4], Object.create(Known.prototype));
console.log("fifth", show(values), inLoop(values));
alter(values[0], null);
alter(values[2], Known.prototype);
console.log("again", show(values), inLoop(values), low(values[0]), middle(values[2]), top(values[4]));
values = made();
console.log("fresh", show(values), inLoop(values));
let yes = 0;
const mixed = [...made(), ...made()];
alter(mixed[0], Known.prototype);
alter(mixed[13], Known.prototype);
alter(mixed[15], Other.prototype);
for (let turn = 0; turn < 300; turn++) for (let i = 0; i < mixed.length; i++) yes += (isKnown(mixed[i]) ? 1 : 0) + (isOther(mixed[i]) ? 100 : 0);
console.log("many", yes, inLoop(mixed));

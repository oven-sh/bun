// A class with more fields than its cell holds. Most of them are defined as undefined, and few objects ever get a value for one.
// A read tells apart: a field that is defined as undefined, one that was never defined, one that was deleted, one that was redefined, and what the prototypes hold under the name.
class Item {
  weight: number;
  constructor(weight: number) {
    this.weight = weight;
  }
}

const seenUnfinished: unknown[] = [];

class Base {
  id: number;
  constructor(id: number) {
    this.id = id;
    this.start();
  }
  start(): void {}
}

class Holder extends Base {
  a0: number;
  a1: number;
  a2: number;
  a3: number;
  a4: number;
  a5: number;
  a6: number;
  a7: number;
  a8: number;
  a9: number;
  a10: number;
  a11: number;
  a12: number;
  a13: number;
  a14: number;
  a15: number;
  a16: number;
  a17: number;
  a18: number;
  a19: number;
  a20: number;
  a21: number;
  a22: number;
  a23: number;
  a24: number;
  a25: number;
  a26: number;
  a27: number;
  a28: number;
  a29: number;
  a30: number;
  a31: number;
  a32: number;
  a33: number;
  a34: number;
  a35: number;
  a36: number;
  a37: number;
  a38: number;
  a39: number;
  a40: number;
  a41: number;
  a42: number;
  a43: number;
  a44: number;
  a45: number;
  a46: number;
  a47: number;
  a48: number;
  a49: number;
  a50: number;
  a51: number;
  a52: number;
  a53: number;
  a54: number;
  a55: number;
  u0: Item | undefined = undefined;
  u1: Item | undefined = undefined;
  u2: Item | undefined = undefined;
  u3: Item | undefined = undefined;
  u4: Item | undefined = undefined;
  u5: Item | undefined = undefined;
  u6: Item | undefined = undefined;
  u7: Item | undefined = undefined;
  u8: Item | undefined = undefined;
  u9: Item | undefined = undefined;
  u10: Item | undefined = undefined;
  u11: Item | undefined = undefined;
  u12: Item | undefined = undefined;
  u13: Item | undefined = undefined;
  u14: Item | undefined = undefined;
  u15: Item | undefined = undefined;
  u16: Item | undefined = undefined;
  u17: Item | undefined = undefined;
  u18: Item | undefined = undefined;
  u19: Item | undefined = undefined;
  u20: Item | undefined = undefined;
  u21: Item | undefined = undefined;
  u22: Item | undefined = undefined;
  u23: Item | undefined = undefined;
  u24: Item | undefined = undefined;
  u25: Item | undefined = undefined;
  u26: Item | undefined = undefined;
  u27: Item | undefined = undefined;
  u28: Item | undefined = undefined;
  u29: Item | undefined = undefined;
  u30: Item | undefined = undefined;
  u31: Item | undefined = undefined;
  declare never: Item | undefined;
  start(): void {
    if (this.id < 0) fill(this, 1);
    if (this.id === 7) seenUnfinished.push(this.u4, this.u31, "u4" in this, Object.keys(this).length);
  }
  constructor(n: number) {
    super(n);
    this.a0 = n + 0.5;
    this.a1 = n + 1.5;
    this.a2 = n + 2.5;
    this.a3 = n + 3.5;
    this.a4 = n + 4.5;
    this.a5 = n + 5.5;
    this.a6 = n + 6.5;
    this.a7 = n + 7.5;
    this.a8 = n + 8.5;
    this.a9 = n + 9.5;
    this.a10 = n + 10.5;
    this.a11 = n + 11.5;
    this.a12 = n + 12.5;
    this.a13 = n + 13.5;
    this.a14 = n + 14.5;
    this.a15 = n + 15.5;
    this.a16 = n + 16.5;
    this.a17 = n + 17.5;
    this.a18 = n + 18.5;
    this.a19 = n + 19.5;
    this.a20 = n + 20.5;
    this.a21 = n + 21.5;
    this.a22 = n + 22.5;
    this.a23 = n + 23.5;
    this.a24 = n + 24.5;
    this.a25 = n + 25.5;
    this.a26 = n + 26.5;
    this.a27 = n + 27.5;
    this.a28 = n + 28.5;
    this.a29 = n + 29.5;
    this.a30 = n + 30.5;
    this.a31 = n + 31.5;
    this.a32 = n + 32.5;
    this.a33 = n + 33.5;
    this.a34 = n + 34.5;
    this.a35 = n + 35.5;
    this.a36 = n + 36.5;
    this.a37 = n + 37.5;
    this.a38 = n + 38.5;
    this.a39 = n + 39.5;
    this.a40 = n + 40.5;
    this.a41 = n + 41.5;
    this.a42 = n + 42.5;
    this.a43 = n + 43.5;
    this.a44 = n + 44.5;
    this.a45 = n + 45.5;
    this.a46 = n + 46.5;
    this.a47 = n + 47.5;
    this.a48 = n + 48.5;
    this.a49 = n + 49.5;
    this.a50 = n + 50.5;
    this.a51 = n + 51.5;
    this.a52 = n + 52.5;
    this.a53 = n + 53.5;
    this.a54 = n + 54.5;
    this.a55 = n + 55.5;
  }
}

function fill(holder: Holder, n: number): void {
  holder.u0 = new Item(n + 0);
  holder.u1 = new Item(n + 1);
  holder.u2 = new Item(n + 2);
  holder.u3 = new Item(n + 3);
  holder.u4 = new Item(n + 4);
  holder.u5 = new Item(n + 5);
  holder.u6 = new Item(n + 6);
  holder.u7 = new Item(n + 7);
  holder.u8 = new Item(n + 8);
  holder.u9 = new Item(n + 9);
  holder.u10 = new Item(n + 10);
  holder.u11 = new Item(n + 11);
  holder.u12 = new Item(n + 12);
  holder.u13 = new Item(n + 13);
  holder.u14 = new Item(n + 14);
  holder.u15 = new Item(n + 15);
  holder.u16 = new Item(n + 16);
  holder.u17 = new Item(n + 17);
  holder.u18 = new Item(n + 18);
  holder.u19 = new Item(n + 19);
  holder.u20 = new Item(n + 20);
  holder.u21 = new Item(n + 21);
  holder.u22 = new Item(n + 22);
  holder.u23 = new Item(n + 23);
  holder.u24 = new Item(n + 24);
  holder.u25 = new Item(n + 25);
  holder.u26 = new Item(n + 26);
  holder.u27 = new Item(n + 27);
  holder.u28 = new Item(n + 28);
  holder.u29 = new Item(n + 29);
  holder.u30 = new Item(n + 30);
  holder.u31 = new Item(n + 31);
}

function weigh(holder: Holder): number {
  let sum = holder.a0;
  const u0 = holder.u0;
  if (u0 !== undefined) sum += u0.weight;
  const u1 = holder.u1;
  if (u1 !== undefined) sum += u1.weight;
  const u2 = holder.u2;
  if (u2 !== undefined) sum += u2.weight;
  const u3 = holder.u3;
  if (u3 !== undefined) sum += u3.weight;
  const u4 = holder.u4;
  if (u4 !== undefined) sum += u4.weight;
  const u5 = holder.u5;
  if (u5 !== undefined) sum += u5.weight;
  const u6 = holder.u6;
  if (u6 !== undefined) sum += u6.weight;
  const u7 = holder.u7;
  if (u7 !== undefined) sum += u7.weight;
  const u8 = holder.u8;
  if (u8 !== undefined) sum += u8.weight;
  const u9 = holder.u9;
  if (u9 !== undefined) sum += u9.weight;
  const u10 = holder.u10;
  if (u10 !== undefined) sum += u10.weight;
  const u11 = holder.u11;
  if (u11 !== undefined) sum += u11.weight;
  const u12 = holder.u12;
  if (u12 !== undefined) sum += u12.weight;
  const u13 = holder.u13;
  if (u13 !== undefined) sum += u13.weight;
  const u14 = holder.u14;
  if (u14 !== undefined) sum += u14.weight;
  const u15 = holder.u15;
  if (u15 !== undefined) sum += u15.weight;
  const u16 = holder.u16;
  if (u16 !== undefined) sum += u16.weight;
  const u17 = holder.u17;
  if (u17 !== undefined) sum += u17.weight;
  const u18 = holder.u18;
  if (u18 !== undefined) sum += u18.weight;
  const u19 = holder.u19;
  if (u19 !== undefined) sum += u19.weight;
  const u20 = holder.u20;
  if (u20 !== undefined) sum += u20.weight;
  const u21 = holder.u21;
  if (u21 !== undefined) sum += u21.weight;
  const u22 = holder.u22;
  if (u22 !== undefined) sum += u22.weight;
  const u23 = holder.u23;
  if (u23 !== undefined) sum += u23.weight;
  const u24 = holder.u24;
  if (u24 !== undefined) sum += u24.weight;
  const u25 = holder.u25;
  if (u25 !== undefined) sum += u25.weight;
  const u26 = holder.u26;
  if (u26 !== undefined) sum += u26.weight;
  const u27 = holder.u27;
  if (u27 !== undefined) sum += u27.weight;
  const u28 = holder.u28;
  if (u28 !== undefined) sum += u28.weight;
  const u29 = holder.u29;
  if (u29 !== undefined) sum += u29.weight;
  const u30 = holder.u30;
  if (u30 !== undefined) sum += u30.weight;
  const u31 = holder.u31;
  if (u31 !== undefined) sum += u31.weight;
  const never = holder.never;
  if (never !== undefined) sum += never.weight;
  return sum;
}

function describe(label: string, holder: Holder): void {
  const keys = Object.keys(holder);
  console.log(
    label,
    weigh(holder),
    keys.length,
    keys.indexOf("u4"),
    keys.indexOf("u30"),
    "u4" in holder,
    Object.hasOwn(holder, "u4"),
    Object.hasOwn(holder, "u30"),
    Object.hasOwn(holder, "never"),
    holder.u4 === undefined ? "undefined" : holder.u4.weight,
    holder.u30 === undefined ? "undefined" : holder.u30.weight,
    holder.never === undefined ? "undefined" : holder.never.weight,
    JSON.stringify(Object.getOwnPropertyDescriptor(holder, "u30")),
  );
}

const event: string = process.argv[2] ?? "nothing";
const holders: Holder[] = [];
for (let i = 0; i < 200; i++) {
  const holder = new Holder(i);
  if (i % 100 === 99) fill(holder, i);
  holders.push(holder);
  if (i === 150) process.emit(event as any, holder as any);
}
let total = 0;
for (let round = 0; round < 20; round++) {
  for (let i = 0; i < holders.length; i++) total += weigh(holders[i]);
}
console.log(total, seenUnfinished);

describe("defined as undefined", holders[0]);
describe("filled", holders[99]);

holders[1].u30 = new Item(1000);
describe("one stored", holders[1]);
holders[1].u30 = undefined;
describe("stored undefined again", holders[1]);

delete (holders[2] as Partial<Holder>).u30;
delete (holders[99] as Partial<Holder>).u30;
describe("deleted while undefined", holders[2]);
describe("deleted while filled", holders[99]);

Object.defineProperty(holders[3], "u30", { get: () => new Item(5000), configurable: true, enumerable: false });
describe("redefined as a getter", holders[3]);
Object.defineProperty(holders[4], "u30", {
  value: new Item(6000),
  writable: false,
  configurable: true,
  enumerable: true,
});
describe("redefined as read-only", holders[4]);
Object.freeze(holders[5]);
describe("frozen", holders[5]);

const prototype = Holder.prototype as unknown as Record<string, unknown>;
prototype.u30 = new Item(70000);
prototype.never = new Item(800000);
describe("hides what the prototype holds", holders[0]);
describe("deleted, so the prototype answers", holders[2]);
describe("deleted, so the prototype answers", holders[99]);
describe("made behind the store to the prototype", new Holder(300));
delete prototype.u30;
delete prototype.never;
(Base.prototype as unknown as Record<string, unknown>).u4 = new Item(9000000);
delete (holders[6] as Partial<Holder>).u4;
describe("the base prototype answers", holders[6]);
describe("hides what the base prototype holds", holders[0]);
delete (Base.prototype as unknown as Record<string, unknown>).u4;

Object.setPrototypeOf(holders[7], { u30: new Item(11), u4: new Item(13), never: new Item(17) });
describe("under another prototype", holders[7]);
delete (holders[7] as Partial<Holder>).u4;
describe("under another prototype, deleted", holders[7]);

// The same under names that are put together while the program runs.
const nameOf = (index: number): string => "u" + (index + Math.min(process.argv.length, 0));
function describeLate(label: string, holder: Holder): void {
  console.log(
    label,
    weigh(holder),
    Object.keys(holder).length,
    Object.hasOwn(holder, "u20"),
    holder.u20 === undefined ? "undefined" : holder.u20.weight,
    holder.u21 === undefined ? "undefined" : holder.u21.weight,
  );
}
describeLate("before", holders[10]);
prototype[nameOf(20)] = new Item(31);
describeLate("hides what the prototype got", holders[10]);
delete (holders[11] as unknown as Record<string, unknown>)[nameOf(20)];
describeLate("deleted, so the prototype answers", holders[11]);
delete prototype[nameOf(20)];
describeLate("deleted, and the prototype lost it", holders[11]);
Object.defineProperty(holders[12], nameOf(21), { get: () => new Item(37), configurable: true, enumerable: true });
describeLate("redefined as a getter", holders[12]);
(Base.prototype as unknown as Record<string, unknown>)[nameOf(21)] = new Item(41);
describeLate("hides what the base prototype got", holders[10]);
delete (holders[13] as unknown as Record<string, unknown>)[nameOf(21)];
describeLate("deleted, so the base prototype answers", holders[13]);
delete (Base.prototype as unknown as Record<string, unknown>)[nameOf(21)];
describeLate("deleted, and the base prototype lost it", holders[13]);

total = 0;
for (let i = 0; i < holders.length; i++) total += weigh(holders[i]);
console.log(total);

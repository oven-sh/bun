// A function or a record of the program gets a property whose name is an index, and arrays inherit from it: holes are read from it, and a setter there takes
// the store. The order does not matter: the property first, or the array first. `describe` is the jsc shell's.
const describe: ((value: unknown) => string) | undefined = (globalThis as any).describe;
function arraysAreSlow(): boolean { const made = [1, 2, 3]; made.push(4); return describe === undefined || /SlowPut/.test(describe(made)); }
function tag(parts: TemplateStringsArray): string { return parts[0] + parts.raw.length + Object.isFrozen(parts); }
console.log(tag`before`);
function show(list: any): string { let text = ""; for (let i = 0; i < list.length; i++) text += (i in list ? "" : "!") + String(list[i]) + ","; return text; }
function everyWay(list: any): string { return [show(list), list.join("|"), list.indexOf("one"), list.includes("one"), show(list.slice(0)), show(list.concat([9])), show([...list]), list.map((one: unknown) => one).length, Object.keys(list).join("")].join(" ; "); }

type Point = { x: number; y: number };
const first: any = [0, , 2, , 4];
const record: Point = { x: 1, y: 2 };
Object.setPrototypeOf(record, Array.prototype);
Object.setPrototypeOf(first, record);
console.log("a record, the array first", everyWay(first));
(record as any)[1] = "one";
console.log("then the index", everyWay(first), (record as any)[1], Object.keys(record).join());
first[3] = "own";
delete (record as any)[1];
console.log("deleted again", everyWay(first), 1 in record);

const other: Point = { x: 3, y: 4 };
Object.setPrototypeOf(other, Array.prototype);
(other as any)[1] = "one";
const second: any = [0, , 2];
Object.setPrototypeOf(second, other);
console.log("a record, the index first", everyWay(second));

function holder() { return 1; }
Object.setPrototypeOf(holder, Array.prototype);
const third: any = [0, , 2, , 4];
Object.setPrototypeOf(third, holder);
console.log("a function, the array first", show(third));
(holder as any)[1] = "one";
console.log("then the index", everyWay(third));
const log: string[] = [];
Object.defineProperty(holder, "3", { get() { return "got"; }, set(value: unknown) { log.push("set " + value); }, configurable: true });
third[3] = "stored";
console.log("a setter at an index", show(third), log.join(), 3 in third, Object.prototype.hasOwnProperty.call(third, 3));

const arrow = () => 2;
Object.defineProperty(arrow, "0", { value: "fixed", writable: false, configurable: true });
const fourth: any = [];
Object.setPrototypeOf(fourth, arrow);
let refused = "no";
try { (function () { "use strict"; fourth[0] = "stored"; })(); } catch (e) { refused = (e as Error).constructor.name; }
console.log("read only at an index", refused, show(fourth), fourth.length, fourth[0]);

const trapped: string[] = [];
const traps: ProxyHandler<object> = { set(target, key, value, receiver) { trapped.push("set " + String(key)); return Reflect.set(target, key, value, receiver); }, get(target, key, receiver) { if (key === "1") trapped.push("get 1"); return Reflect.get(target, key, receiver); } };
const below: Point = { x: 5, y: 6 };
const fifth: any = [0, , 2];
Object.setPrototypeOf(fifth, below);
Object.setPrototypeOf(below, new Proxy(Array.prototype, traps));
fifth[1] = "stored"; fifth[4] = "far"; delete fifth[1];
console.log("a proxy above a record", String(fifth[1]), fifth.length, trapped.join());
class Kept { kept = 1; }
const instance = new Kept();
const sixth: any = [0, , 2];
Object.setPrototypeOf(sixth, instance);
let moved = "moved";
try { Object.setPrototypeOf(instance, new Proxy(Array.prototype, traps)); } catch (e) { moved = "moved"; Object.setPrototypeOf(sixth, new Proxy(Array.prototype, traps)); }
trapped.length = 0; sixth[1] = "stored";
console.log("a proxy above an instance", moved, trapped.join());

const plain: any = {};
const heir: any = [, 1];
Object.setPrototypeOf(heir, Object.create(plain));
Object.defineProperty(plain, "0", { get() { return "far"; }, configurable: true });
console.log("an ordinary object far up", show(heir), arraysAreSlow());
const later = [1, 2, 3]; later.length = 5; later.push(6);
console.log(tag`behind`, show(later), later.length);

type Table = { 1: string; 2: string; name: string };
const tables: Table[] = [];
for (let i = 0; i < 3; i++) tables.push({ 1: "a" + i, 2: "b" + i, name: "t" + i });
const keyed: Point = { x: 7, y: 8 };
(keyed as any)[5] = "five";
console.log("indices on what nothing inherits from", tables[2][1], tables[1][2], Object.keys(tables[0]).join(), (keyed as any)[5]);

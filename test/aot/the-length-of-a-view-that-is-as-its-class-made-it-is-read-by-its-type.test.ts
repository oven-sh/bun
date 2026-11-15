// `.length` at a site that sees texts, lists and views of many kinds: a view that is as its class made it is answered by its type alone. Each case takes that away from a view in another way.
import { buildBothWays } from "./build-both-ways";

const asks = `interface Counted { length: number }
const seen: unknown[] = [];
function ask(list: Counted): void { try { seen.push(list.length); } catch (error) { seen.push((error as Error).constructor.name); } }
function askAny(list: any): void { try { seen.push(list.length); } catch (error) { seen.push((error as Error).constructor.name); } }
const say = (): void => { console.log(seen.join(" ")); seen.length = 0; };
`;

buildBothWays("compile/aot/the length of a view that is as its class made it is read by its type", {
  "a length of its own among many kinds at one site": {
    alone: true,
    files: {
      "main.ts": `${asks}
const own = new Uint16Array(5); const getter = new Int32Array(6); const plain = new Float32Array(7);
const queue: Counted[] = [own, "four", getter, [1, 2, 3], plain, new Int8Array(2)];
for (const each of queue) ask(each); say();
Object.defineProperty(own, "length", { configurable: true, value: 77 });
Object.defineProperty(getter, "length", { configurable: true, get() { seen.push("getter"); return -1; } });
(plain as any).tag = "a name that hides nothing";
for (const each of queue) ask(each); say();
delete (own as any).length; delete (getter as any).length;
for (const each of queue) ask(each); say();
`,
    },
    prints: "5 4 6 3 7 2\n77 4 getter -1 3 7 2\n5 4 6 3 7 2\n",
  },
  "the prototype is another object, the class's again, none": {
    alone: true,
    files: {
      "main.ts": `${asks}
const view = new Float64Array(4); ask(view);
Object.setPrototypeOf(view, { get length() { return "relinked"; } }); ask(view); askAny(view);
Object.setPrototypeOf(view, Float64Array.prototype); ask(view);
Object.setPrototypeOf(view, null); ask(view); askAny(view); say();
const between = Object.create(Int8Array.prototype, { length: { get() { return "between"; } } });
const other = new Int8Array(3); ask(other); Object.setPrototypeOf(other, between); ask(other); say();
`,
    },
    prints: "4 relinked relinked 4  \n3 between\n",
  },
  "subclasses, and the host's own": {
    alone: true,
    files: {
      "main.ts": `${asks}
class Short extends Uint8Array { get length(): number { return 1000 + super.length; } }
class Plain extends Int32Array {}
class Field extends Float32Array { tag = 1; }
for (const each of [new Short(3), new Plain(4), new Field(5), new Uint8Array(6)]) { ask(each); askAny(each); } say();
ask(Buffer.alloc(9)); ask(Buffer.from("abc")); askAny(Buffer.allocUnsafe(2).subarray(1)); say();
`,
    },
    prints: "1003 1003 4 4 5 5 6 6\n9 3 1\n",
  },
  "a view of another realm, detached, resized": {
    alone: true,
    files: {
      "main.ts": `${asks}
import vm from "node:vm";
const foreign = vm.runInNewContext("new Uint8Array(7)"); askAny(foreign); askAny(new Uint8Array(2)); askAny(foreign);
const changed = vm.runInNewContext("Object.defineProperty(Object.getPrototypeOf(Uint8Array.prototype), 'length', { get() { return 'foreign getter'; } }); new Uint8Array(5)"); askAny(changed); askAny(new Uint8Array(1)); say();
const buffer = new ArrayBuffer(16); const fixed = new Uint32Array(buffer); ask(fixed);
structuredClone(buffer, { transfer: [buffer] }); ask(fixed); askAny(fixed); say();
const growing = new ArrayBuffer(8, { maxByteLength: 64 }); const tracks = new Uint8Array(growing); const part = new Uint8Array(growing, 4, 4); const tail = new Uint16Array(growing, 2);
ask(tracks); ask(part); ask(tail); growing.resize(32); ask(tracks); ask(part); ask(tail); growing.resize(6); ask(tracks); ask(part); ask(tail); growing.resize(0); ask(tracks); ask(part); ask(tail); say();
`,
    },
    prints: "7 2 7 foreign getter 1\n4 0 0\n8 4 3 32 4 15 6 0 2 0 0 0\n",
  },
});

// The length getter of %TypedArray%.prototype reached by name from untyped code, where the view's structure is not the original one: subclasses, views with own properties, the getter under another name, receivers that are no typed array.
// Only the jsc shell can count. Elsewhere the count is zero.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const slowReads = () => count("operationAOTGetByIdAndCache");
const lines = [];
const show = (label, value) => lines.push(label + ": " + String(value));

const readLength = o => o.length;
const readSize = o => o.size;

function readRepeatedly(read, receiver) {
  let last;
  for (let i = 0; i < 1000; i++) last = read(receiver);
  return last;
}

function errorOf(action) {
  try {
    return "no error: " + String(action());
  } catch (error) {
    return error.constructor.name;
  }
}

class Bytes extends Uint8Array {}
class Doubles extends Float64Array {}
class Overriding extends Uint16Array {
  get length() {
    return "overridden";
  }
}

const before = slowReads();
show("subclass of Uint8Array", readRepeatedly(readLength, new Bytes(new ArrayBuffer(16), 4, 8)));
show("subclass of Float64Array", readRepeatedly(readLength, new Doubles(new ArrayBuffer(64), 16, 3)));
show("empty subclass view", readRepeatedly(readLength, new Bytes(0)));
show("view with an own property", readRepeatedly(readLength, Object.assign(new Int16Array(5), { tag: "own" })));
show("length stays out of the engine", slowReads() - before <= 20);
show("subclass with its own getter", readRepeatedly(readLength, new Overriding(4)));

const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "length").get;
show("getter under another name", readRepeatedly(readSize, Object.defineProperty(new Float32Array(6), "size", { get: getter })));
const borrowed = Object.defineProperty({}, "size", { get: getter });
show("getter on a plain object", errorOf(() => readSize(borrowed)) + " " + errorOf(() => readSize(borrowed)));
show("getter on a DataView", errorOf(() => readSize(Object.defineProperty(new DataView(new ArrayBuffer(8)), "size", { get: getter }))));

const resizable = new ArrayBuffer(16, { maxByteLength: 64 });
const tracking = new Bytes(resizable, 4);
const fixed = new Bytes(resizable, 4, 8);
const measure = () => readLength(tracking) + " " + readLength(fixed);
show("over a resizable buffer", measure());
resizable.resize(40);
show("after growing", measure());
resizable.resize(8);
show("after shrinking", measure());
resizable.resize(2);
show("out of bounds", measure());

const moved = new Doubles(new ArrayBuffer(32), 8, 2);
show("before the transfer", readLength(moved));
moved.buffer.transfer();
show("after the transfer", readLength(moved) + " " + readLength(moved));

const others = [Object.create(new Bytes(3)), Object.create(Bytes.prototype), Bytes.prototype, { length: "own" }, [1, 2], "text", function (a, b) {}, new DataView(new ArrayBuffer(8)), 5];
show("other receivers", others.map(other => errorOf(() => readLength(other))).join(", "));
show("other receivers again", others.map(other => errorOf(() => readLength(other))).join(", "));

console.log(lines.join("\n"));

// A write that the lock of a built-in object refuses throws a TypeError, whether it assigns, defines or deletes, as a write that JavaScript itself rejects does. A write to a built-in that is not locked succeeds, and so does a new ordinary name on an object that only keeps its members.
const f = function () {};
const d = { value: f, configurable: true, writable: true };
const size: string = ["size"][0];
const writes: [string, () => unknown][] = [
  ["assign over a method of a prototype", () => ((Array.prototype as any).push = f)],
  ["define over a method of a prototype", () => Object.defineProperty(Array.prototype, "push", d)],
  ["delete a method of a prototype", () => delete (Array.prototype as any).push],
  ["define a new property of a prototype that is closed", () => Object.defineProperty(Object.prototype, "added", d)],
  ["define an index of a prototype that takes new names", () => Object.defineProperty(Array.prototype, "7", d)],
  ["allowed: define a new property of a prototype that takes new names", () => Object.defineProperty(Array.prototype, "added", d) === Array.prototype && delete (Array.prototype as any).added],
  ["define over a static method", () => Object.defineProperty(Array, "from", d)],
  ["define over an inherited static method", () => Object.defineProperty(Uint8Array, "from", d)],
  ["define over a function of a namespace", () => Object.defineProperty(Math, "max", d)],
  ["define over an accessor of a constructor", () => Object.defineProperty(Array, Symbol.species, d)],
  ["define a property that hides an inherited one", () => Object.defineProperty(Date, "toString", d)],
  ["define a property that hides an inherited read-only one", () => Object.defineProperty(Array, Symbol.hasInstance, d)],
  ["define a property of a prototype that hides an inherited accessor", () => Object.defineProperty(Uint8Array.prototype, "buffer", d)],
  ["define over a global variable", () => Object.defineProperty(globalThis, "Array", d)],
  ["delete a static method", () => delete (Array as any).from],
  ["delete an accessor of a prototype", () => delete (Map.prototype as any).size],
  ["delete an accessor of a prototype by a computed key", () => delete (Map.prototype as any)[size]],
  ["JavaScript rejects: assign to a read-only number", () => ((Math as any).PI = 3)],
  ["JavaScript rejects: define over a read-only number", () => Object.defineProperty(Math, "PI", d)],
  ["JavaScript rejects: delete a read-only number", () => delete (Math as any).PI],
  ["JavaScript rejects: define over the prototype of a constructor", () => Object.defineProperty(Array, "prototype", d)],
  ["allowed: define a new property of a namespace", () => Object.defineProperty(Math, "added", d) === Math && delete (Math as any).added],
];
for (const [label, write] of writes) {
  try {
    console.log(label + ": " + (write() ? "no error" : "false"));
  } catch (e: any) {
    console.log(label + ": " + e.name);
  }
}

// An index that a list lacks is looked for above the list: in Array.prototype, in Object.prototype, in whatever prototype the list was given. Asked as a number and as a text, read and tested, directly and through a proxy, before and after the prototypes get and lose elements.
function attempt(label, work) { let said; try { said = JSON.stringify(work(), (key, held) => held === undefined ? "undefined" : held); } catch (error) { said = "threw " + error.constructor.name + ": " + error.message; } console.log(label + ": " + said); }
const handsOn = { get(target, key, receiver) { return Reflect.get(target, key, receiver); }, has(target, key) { return Reflect.has(target, key); } };
class Listed extends Array { }
const lists = {
  "small numbers": () => [1, 2],
  "fractions": () => [0.5, 1.5],
  "anything": () => ["a", null],
  "a hole": () => [1, , 3, , , , 7],
  "a hole among fractions": () => [0.5, , 2.5, , , , 6.5],
  "nothing": () => [],
  "frozen": () => Object.freeze([1, , 3]),
  "sealed": () => Object.seal([1, , 3]),
  "shortened": () => { const list = [1, 2, 3, 4, 5, 6, 7, 8]; list.length = 2; return list; },
  "deleted from": () => { const list = [1, 2, 3, 4, 5, 6, 7, 8]; delete list[5]; delete list[7]; return list; },
  "sparse": () => { const list = [1, 2]; list[100000] = 3; return list; },
  "with a name": () => { const list = [1, 2]; list.name = "named"; return list; },
  "of a class": () => Listed.of(1, 2),
  "made by a method": () => [1, 2, 3].slice(0, 2),
  "made by a constructor": () => new Array(2).fill(1),
  "parsed": () => JSON.parse("[1,2]"),
  "another prototype": () => Object.setPrototypeOf([1, 2], { 5: "given five", 9: "given nine" }),
  "a list for a prototype": () => Object.setPrototypeOf([1, 2], [0, 0, 0, 0, 0, "list five"]),
  "no prototype": () => Object.setPrototypeOf([1, 2], null),
  "the prototype taken and given back": () => Object.setPrototypeOf(Object.setPrototypeOf([1, 2], null), Array.prototype),
  "an object with names and elements": () => ({ name: 1, 0: "a", 1: "b" }),
  "an object with names": () => ({ name: 1 }),
  "an object filled by index": () => { const o = {}; o[0] = "a"; o[1] = "b"; return o; },
  "bytes": () => new Uint8Array(2),
  "a map": () => new Map,
};
const numbers = [1, 3, 5, 7, 9], texts = ["1", "3", "5", "7", "9"];
const kept = Object.fromEntries(Object.entries(lists).map(([name, make]) => [name, make()]));
function askAll(when) {
  for (const [name, make] of Object.entries(lists)) {
    for (const [age, list] of [["fresh", make()], ["kept", kept[name]]]) {
      const proxy = new Proxy(list, handsOn);
      attempt(when + ", " + name + ", " + age, () => [numbers.map(key => list[key]), texts.map(key => list[key]), numbers.map(key => key in list), texts.map(key => key in list), numbers.map(key => proxy[key]), numbers.map(key => key in proxy), texts.map(key => Reflect.get(list, key, proxy)), texts.map(key => Reflect.has(list, key)), numbers.map(key => Object.hasOwn(list, key))].map(said => said.join()));
    }
  }
}
for (let round = 0; round < 3; round++) askAll("untouched " + round);
attempt("Array.prototype gets an element", () => { Array.prototype[5] = "array five"; return Array.prototype[5]; });
for (let round = 0; round < 2; round++) askAll("below Array.prototype[5] " + round);
attempt("Object.prototype gets an element", () => { Object.prototype[7] = "object seven"; return Object.prototype[7]; });
for (let round = 0; round < 2; round++) askAll("below Object.prototype[7] " + round);
attempt("Array.prototype gets an accessor", () => { Object.defineProperty(Array.prototype, 9, { get() { return "got by " + (Array.isArray(this) ? "a list" : typeof this); }, configurable: true }); return 9 in Array.prototype; });
for (let round = 0; round < 2; round++) askAll("below an accessor " + round);
attempt("they lose them", () => [delete Array.prototype[5], delete Object.prototype[7], delete Array.prototype[9]]);
for (let round = 0; round < 2; round++) askAll("behind it all " + round);

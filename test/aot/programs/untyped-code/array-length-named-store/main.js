// Stores `x.length = n` where x has no type: arrays of integers, of doubles and of anything are cut, cleared and lengthened; every value that is no index; arrays that may not be written to; what is no array; strict and sloppy.
import sloppy from "./sloppy.cjs";
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lines = [];
function say(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part) ?? String(part))).join(" "));
}
function setLength(target, length) {
  target.length = length;
  return target;
}
function clear(target) {
  target.length = 0;
  return target;
}
function attempt(label, run) {
  try {
    say(label, run());
  } catch (error) {
    say(label, "threw", error.constructor.name);
  }
}
function describe(list) {
  const holes = [];
  for (let i = 0; i < list.length && i < 12; ++i) {
    if (!(i in list)) holes.push(i);
  }
  return [list.length, Array.from(list).slice(0, 12), "holes", holes];
}
const make = {
  integers: n => { const list = []; for (let i = 0; i < n; ++i) list.push(i + 1); return list; },
  doubles: n => { const list = []; for (let i = 0; i < n; ++i) list.push(i + 0.5); return list; },
  anything: n => { const list = []; for (let i = 0; i < n; ++i) list.push(i % 3 === 0 ? "s" + i : i % 3 === 1 ? { i } : i); return list; },
};

for (const kind of Object.keys(make)) {
  for (let warm = 0; warm < 50; ++warm) setLength(make[kind](4), warm % 5);
  say(kind, "cleared", describe(clear(make[kind](5))));
  say(kind, "cut", describe(setLength(make[kind](5), 2)));
  say(kind, "kept", describe(setLength(make[kind](5), 5)));
  say(kind, "one more", describe(setLength(make[kind](5), 6)));
  say(kind, "far more", describe(setLength(make[kind](5), 1000)).slice(0, 1));
  const back = setLength(setLength(make[kind](6), 2), 6);
  say(kind, "cut and lengthened", describe(back), back[3], 3 in back, back.indexOf(undefined), back.includes(undefined));
  back[4] = kind === "doubles" ? 9.5 : 9;
  say(kind, "then written to", describe(back));
  back.push("pushed");
  say(kind, "then pushed to", describe(back));
  say(kind, "cut by 64", describe(setLength(make[kind](70), 6)));
  say(kind, "cut by 65", describe(setLength(make[kind](70), 5)));
  say(kind, "cut by 300", describe(setLength(make[kind](300), 0)));
  const emptied = clear(make[kind](3));
  emptied.push(7);
  say(kind, "cleared and pushed to", describe(emptied), emptied.pop(), emptied.pop(), emptied.length);
}

for (const value of [-1, -0, 1.5, NaN, Infinity, 4294967295, 4294967296, 2147483647, 2147483648, "2", "x", "", null, undefined, true, false, [], [3], {}, { valueOf() { return 1; } }, 3n, Symbol.iterator]) {
  attempt("set to " + (typeof value === "symbol" ? "a symbol" : typeof value === "bigint" ? "3n" : Object.is(value, -0) ? "-0" : JSON.stringify(value) ?? String(value)), () => setLength(make.integers(4), value).length);
}
{
  const order = [];
  const list = make.integers(4);
  setLength(list, { valueOf() { order.push("valueOf"); list.push(9); return 2; } });
  say("a value that changes the array", order, describe(list));
}

attempt("frozen", () => setLength(Object.freeze(make.integers(3)), 1).length);
attempt("frozen, the same length", () => setLength(Object.freeze(make.integers(3)), 3).length);
attempt("sealed", () => setLength(Object.seal(make.integers(3)), 1).length);
attempt("not extensible, cut", () => setLength(Object.preventExtensions(make.integers(3)), 1).length);
attempt("not extensible, lengthened", () => setLength(Object.preventExtensions(make.integers(3)), 5).length);
attempt("length read-only", () => setLength(Object.defineProperty(make.integers(3), "length", { writable: false }), 1).length);
attempt("an element that cannot be deleted", () => { const list = make.integers(4); Object.defineProperty(list, 1, { configurable: false }); try { setLength(list, 0); } catch (error) { return [error.constructor.name, list.length]; } return list.length; });
say("a literal", describe(setLength([1, 2, 3, 4], 2)), describe(clear([1.5, 2.5])), describe(setLength(["a", "b", "c"], 1)), describe(clear([])), describe(setLength([], 3)));
function literal() { return [10, 20, 30]; }
say("the same literal twice", describe(clear(literal())), describe(literal()));
say("with holes", describe(setLength([1, , 3, , 5], 4)), describe(setLength(new Array(5), 2)), describe(setLength(new Array(5), 8)));
{
  const sparse = [];
  sparse[100000] = 1;
  say("sparse", setLength(sparse, 10).length, setLength(sparse, 200000).length);
}
class Stack extends Array {
  top() { return this[this.length - 1]; }
}
{
  const stack = Stack.from([1, 2, 3, 4]);
  for (let i = 0; i < 40; ++i) setLength(Stack.from([1, 2, 3]), i % 4);
  say("a derived array", describe(setLength(stack, 2)), stack.top(), stack instanceof Stack);
}
{
  const named = make.integers(3);
  named.label = "kept";
  say("an array with a property", describe(setLength(named, 1)), named.label, Object.keys(named).join());
}
{
  const log = [];
  const above = { set length(value) { log.push("setter " + value); }, get length() { return 42; } };
  const below = Object.create(above);
  say("a setter up the chain", setLength(below, 3).length, log, Object.keys(below).join());
  const inheriting = Object.create(make.integers(3));
  say("an object whose prototype is an array", setLength(inheriting, 1).length, Object.getPrototypeOf(inheriting).length, Object.keys(inheriting).join());
}
say("a plain object", setLength({ length: 5, 0: "a" }, 1), setLength({}, 2), clear({ length: "text" }));
attempt("a typed array", () => setLength(new Uint8Array(4), 1).length);
attempt("a string object", () => setLength(new String("text"), 1).length);
attempt("a string", () => setLength("text", 1).length);
attempt("a function", () => setLength(function (a, b) {}, 5).length);
attempt("undefined", () => setLength(undefined, 1));
(function () { say("arguments", setLength(arguments, 1).length, arguments[0], arguments[1], Array.from(arguments)); })(1, 2, 3);
{
  const seen = [];
  const proxy = new Proxy(make.integers(3), { set(target, key, value) { seen.push(String(key) + "=" + value); target[key] = value; return true; } });
  say("a proxy of an array", setLength(proxy, 1).length, seen);
}

{
  const scratch = [];
  let sum = 0;
  function round(i) {
    scratch.push(i, i + 1, i + 2);
    sum += scratch.length;
    clear(scratch);
    const names = ["a", "b", { i }];
    setLength(names, 1);
    const halves = [0.5 + i, 1.5, 2.5];
    setLength(halves, 2);
    return scratch.length + names.length + halves.length + halves[0] - i;
  }
  for (let i = 0; i < 100; ++i) sum += round(i);
  const before = count("operationAOTPutByIdAndCache");
  for (let i = 0; i < 3000; ++i) sum += round(i);
  const asked = count("operationAOTPutByIdAndCache") - before;
  say("rounds", sum);
  say(asked <= 200 ? "the stores asked the run time at most 200 times" : "the stores asked the run time " + asked + " times");
}
say("sloppy", sloppy);
console.log(lines.join("\n"));

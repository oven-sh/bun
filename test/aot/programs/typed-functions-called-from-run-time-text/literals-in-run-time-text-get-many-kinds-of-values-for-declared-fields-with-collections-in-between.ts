// Object literals in text that becomes code at run time have the names of a declared type whose fields are an array, a record, a function and a number. They get many kinds of values, with collections in between.
interface Inner { id: number; name: string }
interface Holder { list: string[]; inner: Inner; call: (n: number) => number; count: number; any: unknown }
function read(h: Holder): string {
  let text = "";
  try { text += h.list.length + ":" + h.list[0]; } catch (e) { text += "E1"; }
  try { text += "," + h.inner.id + h.inner.name; } catch (e) { text += "E2"; }
  try { text += "," + h.call(2); } catch (e) { text += "E3"; }
  try { text += "," + (h.count + 1); } catch (e) { text += "E4"; }
  return text + "," + typeof h.any + "," + Object.keys(h).join("");
}
class Heir extends Array<string> {}
const marked: any = ["m"]; marked.extra = 1;
const lists: unknown[] = [["a"], [], [1.5], [{}], new Heir("x", "y"), marked, new Proxy(["p"], {}), new Uint8Array(2), "text", { length: 1, 0: "o" }, null, undefined, Symbol.iterator, 5n, (function () { return arguments; })()];
const inners: unknown[] = [{ id: 1, name: "n" }, { name: "n", id: 1 }, { id: "s", name: 2 }, { id: 1 }, { id: 1, name: "n", more: 1 }, Object.create({ id: 3, name: "up" }), [], null, 7];
const calls: unknown[] = [(n: number) => n + 1, function (n: number) { return n * 2; }, Math.abs, class {}, {}, null, read.bind(null)];
const counts: unknown[] = [1, 1.5, -0, NaN, 2 ** 31, "1", null, undefined, true, 3n, {}];
const given: Holder = { list: ["g"], inner: { id: 0, name: "g" }, call: n => n, count: process.argv.length > 9 ? 1.5 : 0, any: process.argv.length > 9 ? 1 : "s" };
const make = new Function("read", "given", "list", "inner", "call", "count", process.env.OTHER_TEXT ?? "return read({ list: list, inner: inner, call: call, count: count, any: given }) + ';' + read({ any: 1, count, call, inner, list })") as (...all: unknown[]) => string;
let turn = 0;
for (let round = 0; round < 3; round++) {
  for (const list of lists) for (const inner of inners) {
    console.log(make(read, given, list, inner, calls[turn % calls.length], counts[turn % counts.length]));
    if (++turn % 37 === 0) Bun.gc(true);
  }
}

// Calls `object.method(..)` where the method is an own property kept outside the object's cell, next to methods that are inherited, kept in the cell, absent, accessors or no functions, under names used at many places.
const lines = [];
function say(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
}
function attempt(label, run) {
  try {
    say(label, run());
  } catch (error) {
    say(label, "threw", error.constructor.name);
  }
}

function makeWide(tag) {
  const wide = {};
  for (let i = 0; i < 12; ++i) wide["filler" + i] = i;
  wide.write = function (chunk) { return tag + ":" + chunk + ":" + this.filler3; };
  wide.end = function (a, b) { return tag + "/" + a + "/" + b; };
  wide.flush = () => tag;
  wide.three = function (a, b, c) { return [tag, a, b, c, this === wide]; };
  return wide;
}
class Base {
  write(chunk) { return "base:" + chunk; }
  end(a, b) { return "base/" + a + "/" + b; }
  flush() { return "base"; }
  three(a, b, c) { return ["base", a, b, c]; }
}
class Derived extends Base {}
const narrow = { write(chunk) { return "narrow:" + chunk; }, end(a, b) { return "narrow/" + a + "/" + b; }, flush() { return "narrow"; }, three(a, b, c) { return ["narrow", a, b, c]; } };
const bound = makeWide("unbound");
bound.write = bound.write.bind({ filler3: "bound this" });
bound.end = Math.max;
const withGetter = makeWide("getter");
Object.defineProperty(withGetter, "write", { get() { return chunk => "got:" + chunk; } });
const replaced = makeWide("first");

const w01 = o => o.write(1), w02 = o => o.write(2), w03 = o => o.write(3), w04 = o => o.write(4), w05 = o => o.write(5), w06 = o => o.write(6), w07 = o => o.write(7), w08 = o => o.write(8);
const w09 = o => o.write(9), w10 = o => o.write(10), w11 = o => o.write(11), w12 = o => o.write(12), w13 = o => o.write(13), w14 = o => o.write(14), w15 = o => o.write(15), w16 = o => o.write(16);
const writers = [w01, w02, w03, w04, w05, w06, w07, w08, w09, w10, w11, w12, w13, w14, w15, w16];
function useAll(o) {
  return [o.write("a"), o.write("b"), o.write("c"), o.write("d"), o.end(1, 2), o.end(3, 4), o.end(5, 6), o.flush(), o.flush(), o.flush(), o.three(1, 2, 3), o.three(4, 5, 6),
    o.write("e"), o.write("f"), o.write("g"), o.write("h"), o.end(7, 8), o.end(9, 10), o.flush(), o.three(7, 8, 9), o.write("i"), o.write("j"), o.write("k"), o.write("l"),
    o.write("m"), o.write("n"), o.write("o"), o.write("p"), o.write("q"), o.write("r"), o.write("s"), o.write("t"), o.write("u"), o.write("v"), o.write("w"), o.write("x"),
    o.write("y"), o.write("z"), o.write("A"), o.write("B"), o.write("C"), o.write("D"), o.write("E"), o.write("F"), o.write("G"), o.write("H"), o.write("I"), o.write("J"),
    o.write("K"), o.write("L"), o.write("M"), o.write("N"), o.write("O"), o.write("P"), o.write("Q"), o.write("R"), o.write("S"), o.write("T"), o.write("U"), o.write("V")].join("|").length;
}

const receivers = [makeWide("one"), new Base(), new Derived(), narrow, bound, withGetter, makeWide("two")];
for (const receiver of receivers) say(useAll(receiver), writers.map(writer => writer(receiver)).join());
let sum = 0;
for (let i = 0; i < 3000; ++i) {
  const receiver = receivers[i % receivers.length];
  sum += writers[i % writers.length](receiver).length + receiver.end(i, 1).toString().length + receiver.flush().length + receiver.three(i, 2, 3).length;
}
say("sum", sum);

say(replaced.write("x"));
replaced.write = chunk => "second:" + chunk;
say(replaced.write("y"), w01(replaced));
delete replaced.write;
attempt("deleted", () => replaced.write("z"));
attempt("deleted, elsewhere", () => w02(replaced));
replaced.write = 5;
attempt("a number", () => w03(replaced));
replaced.write = null;
attempt("null", () => w04(replaced));
replaced.write = { call() {} };
attempt("an object", () => w05(replaced));
attempt("of undefined", () => w06(undefined));
attempt("of a number", () => w07(7));
attempt("of a string", () => w08("text"));
Object.setPrototypeOf(replaced, Base.prototype);
delete replaced.write;
say("inherited behind the deletion", w09(replaced), replaced.end(1, 2));
console.log(lines.join("\n"));

// The receiver of each method call below is given strings, arrays and other things by its callers,
// so what is predicted for it is a union. The method's name says which of them has such a method.
function show(label, value) {
  console.log(label, JSON.stringify(value));
}
function escapeText(value) {
  return typeof value === "string" ? value.replace("<", "&lt;") : "" + value;
}
function appendAttribute(target, name, value) {
  return target.push(" ", name, '="', escapeText(value), '"');
}
function appendPair(target, first, second) {
  return target.push(first, second);
}
function appendOne(target, value) {
  return target.push(escapeText(value));
}
function attempt(label, run) {
  try {
    show(label, run());
  } catch (error) {
    console.log(label, "threw", error instanceof TypeError ? "TypeError" : String(error));
  }
}

const plain = [];
attempt("array", () => appendAttribute(plain, "href", "<a>"));
attempt("array again", () => appendPair(plain, 1, 2.5));
attempt("array once more", () => appendOne(plain, "<"));
show("plain", plain);

attempt("string", () => appendAttribute("text", "a", "b"));
attempt("string pair", () => appendPair("text", "a", "b"));
attempt("string one", () => appendOne("text", "a"));
attempt("undefined", () => appendAttribute(undefined, "a", "b"));
attempt("null", () => appendPair(null, "a", "b"));

const numbers = [1, 2, 3];
attempt("integers get a double and a string", () => appendPair(numbers, 0.5, "x"));
show("numbers", numbers);
const doubles = [0.5, 1.5];
attempt("doubles get an object", () => appendPair(doubles, {}, 2));
show("doubles", doubles);

const holey = [1, , 3];
attempt("holes", () => appendAttribute(holey, "n", 1));
show("holey", holey);

const frozen = Object.freeze([1]);
attempt("frozen", () => appendPair(frozen, 1, 2));
show("frozen", frozen);
const sealed = Object.seal([1]);
attempt("sealed", () => appendAttribute(sealed, "n", 1));
show("sealed", sealed);
const fixedLength = [1];
Object.defineProperty(fixedLength, "length", { writable: false });
attempt("length cannot be written", () => appendPair(fixedLength, 1, 2));
show("fixedLength", fixedLength);

const own = [];
own.push = function (...values) {
  return "own push took " + values.length;
};
attempt("own method", () => appendAttribute(own, "n", 1));
attempt("own method, pair", () => appendPair(own, 1, 2));
attempt("own method, one", () => appendOne(own, 1));
show("own", own);

class Counting extends Array {
  push(...values) {
    return -super.push(...values);
  }
}
const counting = new Counting();
attempt("subclass", () => appendAttribute(counting, "n", 1));
attempt("subclass, pair", () => appendPair(counting, 1, 2));
show("counting", Array.from(counting));

const lookalike = { length: 2, push: Array.prototype.push };
attempt("an object that borrows the method", () => appendAttribute(lookalike, "n", 1));
show("lookalike", lookalike);

const replacedMeanwhile = [];
function replaceThenEscape(value) {
  replacedMeanwhile.push = () => "the replacement";
  return value;
}
function appendWhileReplaced(target, value) {
  return target.push("first", replaceThenEscape(value), "last");
}
attempt("the method is read before the arguments run", () => appendWhileReplaced(replacedMeanwhile, 1));
attempt("and the replacement is found the next time", () => appendWhileReplaced(replacedMeanwhile, 2));
attempt("a string here too", () => appendWhileReplaced("text", 3));
show("replacedMeanwhile", replacedMeanwhile);

const grownMeanwhile = [];
function growThenAnswer(value) {
  for (let i = 0; i < 40; i++) grownMeanwhile[i] = i;
  return value;
}
function appendWhileGrown(target, value) {
  return target.push("first", growThenAnswer(value), "last");
}
attempt("the array grows while the arguments run", () => appendWhileGrown(grownMeanwhile, 1));
attempt("a string here as well", () => appendWhileGrown("text", 1));
show("grownMeanwhile", grownMeanwhile.slice(38));

const many = [];
for (let turn = 0; turn < 300; turn++) appendAttribute(many, "n" + turn, turn);
show("many", [many.length, many[0], many[1], many[1498], many[1499]]);

function firstKey(table, key) {
  return table.get(key);
}
attempt("a Map", () => firstKey(new Map([["a", 1]]), "a"));
attempt("a WeakMap", () => firstKey(new WeakMap([[plain, 2]]), plain));
attempt("a string has no get", () => firstKey("text", "a"));
attempt("an object with its own get", () => firstKey({ get: key => key + "!" }, "a"));

function trimmed(value) {
  return value.trim();
}
attempt("a string is trimmed", () => trimmed("  x "));
attempt("an array has no trim", () => trimmed([" x "]));
attempt("an object with its own trim", () => trimmed({ trim: () => "mine" }));

// A helper that returns one of several functions, chosen by a constant argument (`typeof`, `===`, `switch` with fall-through, `break` and `default`): what it made is held in a constant and called with as many arguments as the function has, with fewer and with more.
const print = (s) => console.log(s);
const dual = function (arity, body) {
  if (typeof arity === "function") {
    return function () {
      return arity(arguments) ? body.apply(this, arguments) : (self) => body(self, ...arguments);
    };
  }
  switch (arity) {
    case 0:
    case 1:
      throw new RangeError(`Invalid arity ${arity}`);
    case 2:
      return function (a, b) {
        if (arguments.length >= 2)
          return body(a, b);
        return function (self) {
          return body(self, a);
        };
      };
    case 3:
      return function (a, b, c) {
        if (arguments.length >= 3)
          return body(a, b, c);
        return function (self) {
          return body(self, a, b);
        };
      };
    default:
      return function () {
        if (arguments.length >= arity)
          return body.apply(this, arguments);
        const args = arguments;
        return function (self) {
          return body(self, ...args);
        };
      };
  }
};
const pair = dual(2, (a, b) => a + "," + b);
const triple = dual(3, (a, b, c) => a + "," + b + "," + c);
const four = dual(4, (a, b, c, d) => a + "," + b + "," + c + "," + d);
const byTest = dual((args) => args.length > 1, (a, b) => a + "/" + b);
function callAll(x, y, z) {
  let text = "";
  for (let i = 0; i < 3; i++) {
    text += pair(x, y) + " " + pair(y)(x) + " " + pair(x, undefined) + " " + pair(x, y, z) + " | ";
    text += triple(x, y, z) + " " + triple(y, z)(x) + " " + triple(x, y, undefined) + " | ";
    text += four(x, y, z, i) + " " + four(y, z, i)(x) + " | " + byTest(x, y) + " " + byTest(y)(x) + "\n";
  }
  return text;
}
print(callAll(1, "two", null));
for (const bad of [0, 1]) {
  try {
    dual(bad, print);
  } catch (e) {
    print(e.name + ": " + e.message);
  }
}

function choose(kind, strict) {
  let note = "";
  switch (kind) {
    case "first":
      note = "fell from first; ";
    case "second":
      if (strict)
        break;
      return (x) => note + "second " + x;
    case "third":
      return (x) => note + "third " + x;
    default:
      note = "default; ";
      break;
    case "last":
      return (x) => note + "last " + x;
  }
  if (strict === true && kind !== "second")
    return (x) => note + "after the switch, strictly " + x;
  return (x) => note + "after the switch " + x;
}
const first = choose("first", false);
const firstStrict = choose("first", true);
const second = choose("second", false);
const secondStrict = choose("second", true);
const third = choose("third", true);
const other = choose("other", false);
const last = choose("last", false);
const unknown = choose(String(Date.now() > 0 ? "third" : "last"), false);
print([first(1), firstStrict(2), second(3), secondStrict(4), third(5), other(6), last(7), unknown(8)].join("\n"));

function changed(kind) {
  if (kind === 1)
    kind = 2;
  if (kind === 2)
    return () => "two";
  return () => "not two";
}
const one = changed(1);
const two = changed(2);
const three = changed(3);
print(one() + " " + two() + " " + three());

let replaced = dual(2, (a, b) => a - b);
print(replaced(5, 3));
replaced = dual(3, (a, b, c) => a - b - c);
print(replaced(5, 3, 1) + " " + replaced(3, 1)(5));

const alias = pair;
const aliasOfAlias = alias;
let changing = triple;
const aliasOfChanging = changing;
changing = pair;
function callAliases(x, y, z) {
  return aliasOfAlias(x, y) + " " + aliasOfAlias(y)(x) + " " + aliasOfChanging(x, y, z) + " " + changing(x, y) + " " + aliasOfChanging(y, z)(x);
}
print(callAliases("a", "b", "c"));

let fails = false;
function risky() {
  if (fails)
    throw new Error("risky");
}
function guarded(kind) {
  try {
    risky();
    if (kind === 1)
      return () => "made";
    return () => "made of another kind";
  } catch {
    return () => "made after a failure";
  }
}
const calm = guarded(1);
fails = true;
const failed = guarded(1);
print(calm() + " | " + failed());

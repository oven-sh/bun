// `{ [key](x) { .. } }` where `key` is a constant of the program: the method's name is known at the build, so the closure needs no property of its own for it and stays as cheap to call as any other. Here: what can be seen of such a function (name, length, their descriptors, the order of its own keys, its frames in a stack), beside keys that are not constant (a parameter, a variable that changes, a symbol, a number, a getter and a setter), methods of classes, a literal that runs many times, and functions that get properties afterwards.
const lines = [];
const say = (...words) => lines.push(words.map(String).join(" "));
const evaluate = "~kit/evaluate";
const plain = "plainKey";
const empty = "";
const spaced = "two words";
const numeric = 7;
const symbol = Symbol("described");
const bare = Symbol();
let changing = "first";
const describe = f => {
  const name = Object.getOwnPropertyDescriptor(f, "name");
  const length = Object.getOwnPropertyDescriptor(f, "length");
  return [JSON.stringify(f.name), f.length, name && [name.writable, name.enumerable, name.configurable].join(), length && [length.writable, length.enumerable, length.configurable].join(), Reflect.ownKeys(f).map(String).join("+")].join(" | ");
};
const literal = {
  [evaluate](fiber) { return fiber + 1; },
  [plain](a, b) { return a + b; },
  [empty]() { return "empty"; },
  [spaced]() { return "spaced"; },
  [numeric]() { return "numeric"; },
  [symbol]() { return "symbol"; },
  [bare]() { return "bare"; },
  [changing]() { return "changing"; },
  get [evaluate + "/got"]() { return "got"; },
  set [evaluate + "/set"](value) { lines.push("set " + value); },
  [evaluate + "/arrow"]: () => "arrow",
  [evaluate + "/function"]: function () { return "function"; },
  [evaluate + "/named"]: function own() { return "named"; },
  [evaluate + "/class"]: class {},
  async [evaluate + "/async"]() { return "async"; },
  *[evaluate + "/generator"]() { yield "generator"; },
};
for (const key of Reflect.ownKeys(literal)) {
  const descriptor = Object.getOwnPropertyDescriptor(literal, key);
  for (const part of ["value", "get", "set"]) if (typeof descriptor[part] === "function") say("literal", String(key), part, describe(descriptor[part]));
}
say(literal[evaluate](1), literal[plain](1, 2), literal[empty](), literal[spaced](), literal[numeric](), literal[symbol](), literal[bare](), literal.first(), literal[evaluate + "/got"], literal[evaluate + "/arrow"](), literal[evaluate + "/function"](), literal[evaluate + "/named"]());
literal[evaluate + "/set"] = 5;
changing = "second";
class Kit {
  [evaluate](fiber) { return fiber + 2; }
  static [evaluate](fiber) { return fiber + 3; }
  get [plain]() { return "got"; }
  [symbol]() { return "symbol"; }
  [changing]() { return "changing"; }
  static [plain] = () => "a field";
}
say("class", describe(Kit.prototype[evaluate]), "/", describe(Kit[evaluate]), "/", describe(Object.getOwnPropertyDescriptor(Kit.prototype, plain).get), "/", describe(Kit.prototype[symbol]), "/", describe(Kit.prototype.second), "/", describe(Kit[plain]));
say(new Kit()[evaluate](1), Kit[evaluate](1));
const make = key => ({ [key](x) { return x; }, [evaluate](x) { return -x; } });
const made = [make("one"), make("two"), make(evaluate), make(symbol), make(3)];
for (const object of made) say("made", Reflect.ownKeys(object).map(key => String(key) + ": " + describe(object[key])).join(" / "));
say("made apart", made[0][evaluate] !== made[1][evaluate], made[0][evaluate].name === made[1][evaluate].name);
const changed = make("x")[evaluate];
say("before", describe(changed), changed(4));
changed.extra = 1;
say("a property more", describe(changed), changed(4));
Object.defineProperty(changed, "name", { value: "renamed" });
say("renamed", describe(changed), changed(4));
say("deleted", delete changed.name, describe(changed), changed(4));
const other = make("x")[evaluate];
say("another one is untouched", describe(other), other(4));
say("strict assignment", (() => { "use strict"; try { other.name = "no"; return "stored"; } catch (error) { return error.constructor.name; } })(), describe(other));
say("bound", describe(other.bind(null)));
say("to string tag", Object.prototype.toString.call(literal[evaluate]), typeof literal[evaluate], literal[evaluate] instanceof Function, "prototype" in literal[evaluate]);
const thrower = { [evaluate]() { throw new Error("thrown"); }, written() { throw new Error("thrown"); } };
for (const key of [evaluate, "written"]) {
  try { thrower[key](); } catch (error) { say("frame of", key, "names it:", String(error.stack).split("\n").slice(0, 3).some(line => line.includes(key))); }
}
let total = 0;
for (let i = 0; i < 1000; i++) total += literal[evaluate](i) + new Kit()[evaluate](i) + made[i % 5][evaluate](i);
say("total", total);
console.log(lines.join("\n"));

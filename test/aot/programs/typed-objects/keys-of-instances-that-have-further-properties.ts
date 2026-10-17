// Object.keys at one typed place, of instances that were given properties their class does not declare: every set of further keys, every order, and every change in between has its own list; a list handed out is the caller's to change.
class Options {
  host = "localhost";
  port = 80;
  path?: string;
  secure?: boolean;
}
const lines: string[] = [];
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
function keysOf(options: Options): string[] {
  return Object.keys(options);
}
function say(label: string, options: Options) {
  const first = keysOf(options);
  const second = keysOf(options);
  first.push("pushed");
  first[0] = "changed";
  lines.push(label + ": " + second.join() + " | " + keysOf(options).join() + " | " + (first !== second) + " | " + Object.getOwnPropertyNames(options).join() + " | " + Reflect.ownKeys(options).map(String).join());
}
const given = (more: [PropertyKey, unknown][]): Options => {
  const options = new Options();
  for (const [key, value] of more) (options as any)[key] = value;
  return options;
};
for (let round = 0; round < 4; round++) {
  say("none " + round, given([]));
  say("one " + round, given([["tag", round]]));
  say("another " + round, given([["label", round]]));
  say("two " + round, given([["tag", 1], ["label", 2]]));
  say("two the other way round " + round, given([["label", 2], ["tag", 1]]));
  const late = given([["tag", 1]]);
  say("before the optional fields " + round, late);
  late.path = "/";
  say("an optional field behind the further key " + round, late);
  late.secure = true;
  (late as any).more = 1;
  say("and more " + round, late);
  delete (late as any).tag;
  say("the first further key deleted " + round, late);
  delete late.path;
  say("an optional field deleted " + round, late);
  (late as any).tag = 2;
  say("the further key again " + round, late);
  const early = new Options();
  early.secure = false;
  (early as any).tag = 1;
  early.path = "x";
  say("optional fields on both sides " + round, early);
  const hidden = given([["tag", 1]]);
  Object.defineProperty(hidden, "hidden", { value: 1, enumerable: false, configurable: true });
  say("a key that is not listed " + round, hidden);
  const marked = given([["tag", 1], [Symbol.for("mark"), 2]]);
  say("a symbol " + round, marked);
  const indexed = given([["tag", 1], [1, "one"], [0, "zero"]]);
  say("index keys " + round, indexed);
  const computed = given([["tag", 1]]);
  Object.defineProperty(computed, "got", { get: () => 1, enumerable: true, configurable: true });
  say("a getter " + round, computed);
  say("frozen " + round, Object.freeze(given([["tag", 1]])));
  say("sealed " + round, Object.seal(given([["tag", 1]])));
  const many = given(Array.from({ length: 70 }, (_, i): [string, number] => ["k" + i, i]));
  lines.push("seventy " + round + ": " + keysOf(many).length + " " + keysOf(many)[71]);
  if (round === 1) collect();
}
const kept: Options[] = [];
for (let i = 0; i < 300; i++) kept.push(given([["tag" + (i % 5), i]]));
collect();
let total = 0;
for (let round = 0; round < 3; round++) for (const options of kept) total += keysOf(options)[2].length + keysOf(options).length;
lines.push("three hundred of five kinds: " + total);
console.log(lines.join("\n"));

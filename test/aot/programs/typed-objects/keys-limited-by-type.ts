// `object[key]` where the type of the key is a union of a few names, some of which no code of the program writes: every key reads and stores what it does in plain Bun.
const shift = Date.now() < 1 ? 1 : 0;
function spell(reversed: string): string {
  let text = "";
  for (let i = reversed.length - 1; i >= 0; i--) text += String.fromCharCode(reversed.charCodeAt(i) + shift);
  return text;
}
interface Options {
  limit: number;
  depth: number;
  neverWritten?: number;
  alsoNeverWritten?: string;
}
type Key = keyof Options;
function read(options: Options, key: Key): unknown {
  return options[key];
}
function write(options: Options, key: "limit" | "depth" | "neverWritten", value: number): void {
  options[key] = value;
}
const options: Options = { limit: 1, depth: 2 };
const first = spell("nettirWreven") as "neverWritten";
const second = spell("nettirWreveNosla") as Key;
console.log(read(options, "limit"), read(options, "depth"), read(options, first), read(options, second));
write(options, "limit", 3);
write(options, spell("htped") as "depth", 4);
console.log(read(options, "limit"), read(options, "depth"), Object.keys(options).join());
write(options, first, 5);
console.log(read(options, first), Object.keys(options).length, JSON.stringify(options).length, first in options, second in options);
(options as any)[second] = "text";
console.log(read(options, second), Object.keys(options).length, Object.values(options).join());
delete (options as any)[first];
console.log(read(options, first), Object.keys(options).length);
const parsed = JSON.parse('{"limit":6,"depth":7,"' + first + '":8}') as Options;
console.log(read(parsed, first), read(parsed, "limit"), Object.keys(parsed).length);
class Counter {
  hits = 0;
  misses = 0;
  bump(which: "hits" | "misses"): number {
    return ++this[which];
  }
}
const counter = new Counter();
console.log(counter.bump("hits"), counter.bump("hits"), counter.bump(spell("sessim") as "misses"), counter.hits, counter.misses);

// IR+ ^layout L\d+ .*name="Reader" .*isNeverAllocated=true
// IR+ ^layout L\d+ .*name="Nested" .*isNeverAllocated=true
// IR+ ^layout (L\d+) .*name="Reader" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="Nested" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout L\d+ .*name="Settings" (?!.*isNeverAllocated=true)
// IR+ ^layout L\d+ .*name="Both" (?!.*isNeverAllocated=true)
import { look, mangle, give, giveOdd, keep, through, call } from "./untyped.js";

interface Settings { path: string; depth: number; strict: boolean; note?: string }
interface Given { id: number; label: string; next?: Given }
interface Both { w: number; h: number; tag: string }
interface Nested { settings: Settings; list: Settings[] }
interface Reader { get: () => number; name: string }

function say(name: string, f: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(f()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  console.log(name + ": " + text);
}

function settingsOf(i: number): Settings {
  return i & 1 ? { path: "p" + i, depth: i, strict: true } : { strict: false, depth: i + 0.5, path: "q", note: "even" };
}
function labelOf(given: Given): string {
  return given.label + ":" + given.id + (given.next ? ">" + labelOf(given.next) : "");
}
function area(both: Both): number {
  return both.w * both.h + both.tag.length;
}
function bothOf(i: number): Both {
  return { w: i, h: i + 1, tag: "t" };
}

function readerOf(n: number): Reader {
  return { get: () => n * 2, name: "r" + n };
}
say("a literal that holds a function", () => {
  let total = 0;
  for (let i = 0; i < 300; i++) total += call(readerOf(i));
  return [total, Object.keys(through(readerOf(1))), call(readerOf(21))];
});
say("made here, read there", () => [look(settingsOf(1)), look(settingsOf(2))]);
say("the order of the keys is the literal's", () => [Object.keys(through(settingsOf(1))), Object.keys(through(settingsOf(2)))]);
say("what untyped code does to it", () => mangle(settingsOf(3)));
say("each literal is its own object", () => {
  const kept: unknown[] = [];
  for (let i = 0; i < 300; i++) keep(kept, settingsOf(i), i);
  return [kept.length, look(kept[0]), look(kept[kept.length - 1]), kept[0] === kept[1]];
});
say("it is an ordinary object", () => {
  const made: unknown = through(settingsOf(5));
  return [Object.getPrototypeOf(made) === Object.prototype, Object.isExtensible(made), Object.getOwnPropertyDescriptor(made, "depth"), JSON.stringify(made), { ...(made as object), more: 1 }];
});
say("within another literal", () => {
  const nested: Nested = { settings: settingsOf(7), list: [settingsOf(8), settingsOf(9)] };
  return look(through(nested).settings) + "|" + through(nested).list.map(look).join();
});
say("given there, read here", () => [labelOf(give(1)), labelOf(give(2)), labelOf(give(3))]);
say("many given", () => {
  let length = 0;
  for (let i = 0; i < 300; i++) length += labelOf(give(i & 3)).length;
  return length;
});
say("given with a getter, more keys, another prototype, frozen", () => giveOdd().map((given: Given) => labelOf(given)));
say("stored into what was given", () => {
  const given: Given = give(1);
  given.label = "stored";
  given.next = give(0);
  return [labelOf(given), Object.keys(given)];
});
say("made and read here, and given too, keeps working", () => {
  let total = 0;
  for (let i = 0; i < 300; i++) total += area(bothOf(i)) + area(through({ w: 1, h: i, tag: "given" }));
  return [total, look(bothOf(2)), Object.keys(through(bothOf(3)))];
});

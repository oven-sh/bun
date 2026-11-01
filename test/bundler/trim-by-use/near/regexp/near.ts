const lines: string[] = [];
const say = (name: string, value: unknown) => lines.push(`${name}: ${JSON.stringify(value)}`);

const text = "2026-10-17 bun 1.4.3, node 25.6.0; a.b*c a.b*c";
say("replace, a string", text.replace("a.b*c", "[$&]"));
say(
  "replace, a function",
  text.replace("bun", found => found.toUpperCase()),
);
say("replaceAll, a string", text.replaceAll("a.b*c", "x$$"));
say("replaceAll, one character", text.replaceAll(".", "_"));
say("split, strings", [
  text.split(", "),
  text.split("", 3),
  text.split(" ", 2),
  "a,b".split(undefined as unknown as string),
]);
say("indexOf and friends", [
  text.indexOf("node"),
  text.lastIndexOf("a"),
  text.includes("1.4"),
  text.startsWith("2026"),
  text.endsWith("*c"),
]);

const splitter = { [Symbol.split]: (subject: string, limit?: number) => [subject.length, limit ?? -1] };
const replacer = { [Symbol.replace]: (subject: string, by: string) => `${by}:${subject.length}` };
say("an object that splits", text.split(splitter as unknown as string, 4));
say("an object that replaces", [
  text.replace(replacer as unknown as string, "by"),
  text.replaceAll(replacer as unknown as string, "all"),
]);
say("the symbols", [Symbol.match, Symbol.matchAll, Symbol.replace, Symbol.search, Symbol.split].map(String));
try {
  say("startsWith, an object", text.startsWith({ [Symbol.match]: true } as unknown as string));
} catch (error) {
  say("startsWith, an object", (error as Error).name);
}
say("what a plain object is", [Object.prototype.toString.call({}), Object.prototype.toString.call("x")]);

const held: string[] = [];
for (let round = 0; round < 4; round++) {
  for (let at = 0; at < 20000; at++) held[at % 1000] = ("k" + at).replace("k", "key ").split(" ").join("-");
  Bun.gc(true);
}
say("after four full collections", held[7]);
for (const piece of ["a", "b"].values()) say("an iterator", piece);
say("trim, pad, case", ["  x ".trim(), "7".padStart(3, "0"), "Straße".toUpperCase(), "ǅ".toLowerCase()]);
console.log(lines.join("\n"));

const lines: string[] = [];
const say = (name: string, value: unknown) => lines.push(`${name}: ${JSON.stringify(value)}`);

const text = "2026-10-18 bun 1.4.3, node 25.6.0; a,b;C";
say("test, exec", [/\d{4}-\d\d/.test(text), /^node/.test(text), /(\w+) (\d+)\.(\d+)/.exec(text)]);
say("replace, replaceAll", [
  text.replace(/\d+/g, "#"),
  text.replace(/\b[a-z]/g, letter => letter.toUpperCase()),
  text.replaceAll(/[,;]/g, "|"),
]);
say("split", [text.split(/[,;] ?/), text.split(/ /, 2), text.split(/(\d)\./)]);
say("source, flags, lastIndex", [/a\/b/gi.source, /a/dgimsuy.flags, /a/g.lastIndex, String(/x+/v)]);

const tagged = /,/;
Object.defineProperty(tagged, "tag", { value: 1 });
say("split, a literal with a property of its own", [text.split(tagged), text.split(tagged, 2), tagged.lastIndex]);

const ignoresCase = /c/;
Object.defineProperty(ignoresCase, "flags", { value: "i" });
say("split, a literal with flags of its own", text.split(ignoresCase));

const withoutConstructor = /;/;
Object.defineProperty(withoutConstructor, "constructor", { value: undefined });
say("split, a literal with no constructor", text.split(withoutConstructor));

const invalidFlags = /,/;
Object.defineProperty(invalidFlags, "flags", { value: "z" });
try {
  say("split, a literal with invalid flags", text.split(invalidFlags));
} catch (error) {
  say("split, a literal with invalid flags", (error as Error).name);
}

const own = {
  match: (subject: string) => subject.length,
  matchAll: () => "all",
  search: () => -1,
  compile: () => "compiled",
};
say("methods of the program's own object", [own.match(text), own.matchAll(), own.search(), own.compile()]);
console.log(lines.join("\n"));

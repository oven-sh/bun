const lines: string[] = [];
const say = (name: string, value: unknown) => lines.push(`${name}: ${JSON.stringify(value)}`);

const text = "2026-10-17 bun 1.4.3, node 25.6.0; Zoë wrote 12 tests, 3 failed";
say("test", [/\d{4}-\d\d-\d\d/.test(text), /^node/.test(text)]);
say("exec", /(\w+) (\d+)\.(\d+)\.(\d+)/.exec(text));
say("named groups", /(?<year>\d{4})-(?<month>\d\d)/.exec(text)?.groups);
say("match, global", text.match(/\d+/g));
say(
  "matchAll",
  [...text.matchAll(/([a-z]+) (\d+)/g)].map(found => [found.index, found[1], found[2]]),
);
say("replace", text.replace(/(\d+)\.(\d+)\.(\d+)/g, "$3.$2.$1"));
say(
  "replace by a function",
  text.replace(/\b[a-z]/g, letter => letter.toUpperCase()),
);
say("split", text.split(/[,;] /));
say("search", text.search(/wrote/));
say("an atom", "a/b/c".replace(/\//g, "-"));
say("made from text", new RegExp("z" + "o.", "iu").exec(text)?.[0]);
say("match with a string", text.match("no.e")?.[0]);
say(
  "sticky, lastIndex",
  (() => {
    const sticky = /\d+/y;
    sticky.lastIndex = 5;
    return [sticky.exec(text)?.[0], sticky.lastIndex];
  })(),
);
say("lookbehind, backreference", [text.match(/(?<=bun )\S+/)?.[0], /(\d)\1/.exec("1223")?.[0]]);
say("source, flags", [/a\/b/gi.source, /a/dgimsuy.flags, String(/x+/v)]);
say("escape", (RegExp as unknown as { escape?: (text: string) => string }).escape?.("a.b*c") ?? "none");
say("many ways", /^(?:a?){18}a{18}$/.test("a".repeat(18)));
say("a wide subject", "日本語のテキスト、テスト".split(/[、。]/));
console.log(lines.join("\n"));

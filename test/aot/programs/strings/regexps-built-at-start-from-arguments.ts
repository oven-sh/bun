// The twin of regexps-built-at-start.ts: a piece of each text comes from the arguments of the program, which the build cannot know. The image has no code for these, the running program parses and interprets them, and they answer what they answer in plain Bun. The tokens that are constants keep their code, though the call that makes them is given a text from outside too.
// COUNTER: RegExpsCreatedWithoutRecord = 12
// COUNTER: RegExpPatternsParsed >= 12
// COUNTER: RegExpMatchesInterpreted >= 12
// KNOWN tokens 0|[1-9]\d*
// KNOWN tokens \d*[a-zA-Z-][a-zA-Z0-9-]*
// KNOWN tokens (0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)
// KNOWN tokens (?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*)
// KNOWN tokens (?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*))*))
// KNOWN tokens ^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*))*))?$
// KNOWN tokens (^|[^\d])(\d{1,16})(?:\.(\d{1,16}))?
// UNKNOWN ^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$
// UNKNOWN (?:\+(\d*[a-zA-Z-][a-zA-Z0-9-]*))
// UNKNOWN ^[a-z]+$
// UNKNOWN ^[0-9]+(?:\.[0-9]+)?$
// UNKNOWN ^#.*$
// UNKNOWN ^a.b$
// UNKNOWN a\.b|c\+d|\(e\)
// UNKNOWN \bonClick\b
// UNKNOWN \b(?:if|else|while)\b
// UNKNOWN \[\s*x\s*y\s*\]
// UNKNOWN <div(\s[^>]*)?>
// UNKNOWN <span(\s[^>]*)?>
import tokensModule, { src, t } from "./regexps-built-at-start.cjs";
const tokens = tokensModule as any;

// No run of this test passes an argument, so the piece is empty. The jsc shell has no `process`: there the piece comes from the clock, which the build knows as little.
const given: string = typeof process === "object" ? process.argv.slice(2).join("") : String(Date.now()).slice(0, 0);

const names: any = t;
const release = new RegExp(`^${src[names.MAINVERSION]}${given}$`);
tokens.createToken("BUILD", `(?:\\+(${src[names.NONNUMERICIDENTIFIER]}))${given}`);

type Rule = { name: string; source: string; insensitive?: boolean; multiline?: boolean };
const rules: Rule[] = [
  { name: "word", source: "[a-z]+" + given, insensitive: true },
  { name: "number", source: "[0-9]+(?:\\.[0-9]+)?" + given },
  { name: "line", source: "#.*" + given, multiline: true },
  { name: "dotted", source: "a.b" + given },
];
function grouped(source: string): string {
  return source.includes("|") ? `(?:${source})` : source;
}
const compiled = rules.map(rule => ({
  name: rule.name,
  expression: new RegExp("^" + grouped(rule.source) + "$", (rule.insensitive ? "i" : "") + (rule.multiline ? "m" : "")),
}));

class Builder {
  #parts: string[] = [];
  constructor(private readonly separator: string) {}
  add(part: string): this {
    this.#parts.push(part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return this;
  }
  build(flags?: string): RegExp {
    return new RegExp(this.#parts.join(this.separator), flags);
  }
}
const alternatives = new Builder("|" + given).add("a.b").add("c+d").add("(e)").build("g");

function Legacy(this: any, prefix: string) {
  this.prefix = prefix;
}
Legacy.prototype.make = function (name: string) {
  return new RegExp(this.prefix + name + "\\b");
};
const legacy = new (Legacy as any)("\\bon" + given).make("Click");

const keywords: Record<string, number> = { if: 1, else: 2, while: 3 };
let joined = "";
for (const key in keywords) joined += (joined ? "|" : given) + key;
const keyword = new RegExp(`\\b(?:${joined})\\b`);

const [open, close] = ["\\[", "\\]" + given];
const bracketed = new RegExp([open, ...["x", "y"], close].join("\\s*"));

let cache: Map<string, RegExp> | undefined;
function cached(name: string): RegExp {
  cache ??= new Map();
  let found = cache.get(name);
  if (!found) cache.set(name, (found = new RegExp(`<${name}${given}(\\s[^>]*)?>`, "i")));
  return found;
}

console.log(tokens.re[tokens.t.FULL].test("1.2.3-beta.4"), tokens.re[tokens.t.COERCE].flags, tokens.re.length);
console.log(release.test("1.2.3"), release.test("1.2.3-beta.4"), tokens.re[tokens.t.BUILD].test("1.2.3+build-7"), tokens.re[tokens.t.BUILD].test("1.2.3"));
console.log(compiled.map(entry => `${entry.name}:${entry.expression.flags}:${entry.expression.test("Abc")}`).join(" "));
console.log("a.b c+d (e) axb".match(alternatives)?.length, legacy.test("an onClick handler"), keyword.test("a while b"), bracketed.test("[ x y ]"));
console.log(cached("div").test("<DIV class=x>"), cached("span").test("<div>"), cached("div") === cached("div"));
console.log([release, tokens.re[tokens.t.BUILD], ...compiled.map(entry => entry.expression), alternatives, legacy, keyword, bracketed, cached("div"), cached("span")].map(expression => expression.source).join(" "));

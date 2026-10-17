// Regular expression literals of every kind of syntax, each matched against 8-bit and 16-bit strings.
const any = (x: unknown): any => x;
function show(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) {
    const m = any(v);
    let s = "[" + v.map(show).join(",") + "]";
    if (typeof m.index === "number") s += "@" + m.index;
    if (m.groups) s += JSON.stringify(m.groups);
    if (m.indices) s += JSON.stringify(m.indices);
    return s;
  }
  if (typeof v === "string") return JSON.stringify(v).replace(/[^\x20-\x7e]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  return String(v);
}
function say(what: string, f: () => unknown) {
  let r: string;
  try { r = show(f()); } catch (e) { r = "throws " + any(e).constructor.name + ": " + any(e).message; }
  console.log(what + ": " + r);
}
const wide = (s: string) => (s + "一").slice(0, -1);
function both(what: string, re: RegExp, ...subjects: string[]) {
  for (const s of subjects) {
    say(what + " 8", () => { re.lastIndex = 0; return re.exec(s); });
    say(what + " 16", () => { re.lastIndex = 0; return re.exec(wide(s)); });
  }
}

both("literal", /abc/, "xxabcxx", "ab", "");
both("class", /[a-c]+[^a-c]/, "xxabcabz", "abc");
both("escapes", /\d+\s\w+\b\W/, "a 12 ab! ", "12ab");
both("alternatives", /^(?:foo|bar|bazaar)$/, "foo", "bazaar", "baz");
both("anchored words", /^(?:get|set|has|delete)[A-Z]/, "getX", "deleteY", "putZ");
both("greedy", /a(.*)b(.*)c/, "a1b2b3c4c");
both("lazy", /a(.*?)b(.*?)c/, "a1b2b3c4c");
both("counted", /^(\d{2,4})-(\d{1,}?)-(\d{0,2})$/, "123-45-6", "1-2-3", "12345-6-7");
both("nested groups", /((a)|(b))+(c)?/, "abab", "abc", "c");
both("named groups", /(?<year>\d{4})-(?<month>\d\d)/, "on 2026-10-01", "2026");
both("backreference", /(['"])(.*?)\1/, "say 'it' \"now\"", "'open");
both("named backreference", /(?<q>a|b)x\k<q>/, "axb bxb", "axb");
both("lookahead", /\w+(?=;)(?!;;)/, "ab; cd;;", "ab");
both("negative lookahead", /^(?!.*secret).*$/, "public", "a secret");
both("lookbehind", /(?<=\$)\d+(?<!0)/, "cost $120 $125", "125");
both("ignore case", /straSSe|ÀB/i, "STRASSE", "àb", "ab");
both("multiline", /^b.$/m, "ab\nbc\ncd", "ab");
both("dot all", /a.b/s, "a\nb", "a b");
both("not dot all", /a.b/, "a\nb", "a\rb", "a-b");
both("empty match", /x*/, "aaa", "");
both("empty alternative", /a(?:|b)c/, "ac", "abc", "abbc");
both("has indices", /(a)(?<n>b)?/d, "xab", "xa");
both("latin-1", /[\xe0-\xff]+/, "caf\xe9s", "cafes");
both("backtracking", /^(a+)+b$/, "aaaaaaaaaaaab", "aaaaaaaaaaaaaaaaaac");
both("long alternation", /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/, "it is eleven", "elevens");

say("wide literal", () => /一二/.exec("x一二y"));
say("wide class", () => /[一-鿿]+/.exec("ab一二三cd"));
say("wide negated class", () => /[^一-鿿]+/.exec("一ab二"));
say("wide ignore case", () => [/σ/i.exec("Σ"), /Σ/i.exec("ς"), /K/i.exec("k"), /k/i.exec("K")]);
say("wide backreference", () => /(一+)x\1/.exec("一一x一一一"));
say("wide backreference, ignoring case", () => /(σ+)x\1/i.exec("σΣxΣσ"));
say("a pair is two characters", () => [/^.$/.test("\u{1f600}"), /^..$/.test("\u{1f600}"), /\ud83d/.exec("\u{1f600}")]);

both("u literal", /a\u{62}c/u, "xabc", "ab");
both("u class", /[a-c\u{1f600}-\u{1f64f}]+/u, "xxabz", "z");
both("u property", /\p{Lu}\p{Ll}+/u, "say Hello", "hello");
both("u negated property", /\P{L}+/u, "ab12cd", "abcd");
both("u ignore case", /straße|k/iu, "STRASSE", "STRAßE", "K");
both("u named group", /(?<w>\p{L}+)-\k<w>/u, "ab-ab", "ab-ac");
both("u lookbehind", /(?<=\p{Lu})\d/u, "a1B2", "a1");
const pairs = "a\u{1f600}b\u{1f64f}\u{1f600}c";
say("u dot", () => [/^.$/u.test("\u{1f600}"), /^..$/u.test("\u{1f600}"), /a.b/u.exec(pairs)]);
say("u class with pairs", () => /[\u{1f600}-\u{1f64f}]+/u.exec(pairs + pairs));
say("u negated class with pairs", () => /[^a-c]+/u.exec(pairs));
say("u counted pairs", () => /\u{1f600}{2,3}/u.exec("x\u{1f600}\u{1f600}\u{1f600}\u{1f600}"));
say("u greedy then backtrack", () => /^(.*)\u{1f600}(.*)$/u.exec(pairs));
say("u lazy", () => /^(.*?)\u{1f600}(.*?)$/u.exec(pairs));
say("u emoji property", () => "a\u{1f600}1❤b".match(/\p{Extended_Pictographic}/gu));
say("u script", () => "ab一二あЖ".match(/\p{Script=Han}+|\p{Script=Cyrillic}/gu));
say("u astral letters", () => /\p{L}+/u.exec("1\u{10400}\u{10428}\u{20000}2"));
say("u astral ignore case", () => [/\u{10400}/iu.exec("\u{10428}"), /[\u{10400}-\u{10410}]/iu.exec("x\u{10430}")]);
say("u backreference to a pair", () => /(\u{1f600}+)-\1/u.exec("\u{1f600}\u{1f600}-\u{1f600}\u{1f600}\u{1f600}"));
say("u backreference, ignoring case", () => /(\u{10400})-\1/iu.exec("\u{10400}-\u{10428}"));
say("u lookbehind over pairs", () => [/(?<=\u{1f600})b/u.exec(pairs), /(?<=^.{3})./u.exec(pairs), /(?<!\u{1f64f})\u{1f600}/u.exec(pairs)]);
say("u word boundary", () => /\b\w+\b/u.exec("\u{1f600}ab\u{1f600}"));

const lead = "\ud83d", trail = "\ude00";
say("u lone lead at the end", () => [/.$/u.exec("a" + lead), /^.$/u.test(lead), /\ud83d/u.exec("a" + lead)]);
say("u lone trail at the start", () => [/^./u.exec(trail + "a"), /^.$/u.test(trail), /\ude00/u.exec(trail + "a")]);
say("u lone lead inside", () => /a(.)b/u.exec("a" + lead + "b"));
say("u lone trail inside", () => /a(.)b/u.exec("a" + trail + "b"));
say("u two leads", () => /^(.)(.)$/u.exec(lead + lead));
say("u trail then lead", () => /^(.)(.)$/u.exec(trail + lead));
say("u a lead does not match in a pair", () => [/\ud83d/u.exec("\u{1f600}"), /\ude00/u.exec("\u{1f600}"), /[\ud83d]/u.exec("\u{1f600}"), /[^\ud83d]/u.exec("\u{1f600}")]);
say("u starting inside a pair", () => { const re = /./gu; re.lastIndex = 1; const m = re.exec("\u{1f600}a"); return [m, re.lastIndex]; });
say("u sticky inside a pair", () => { const re = /./uy; re.lastIndex = 1; const m = re.exec("\u{1f600}a"); return [m, re.lastIndex]; });
say("u sticky trail inside a pair", () => { const re = /\ude00/uy; re.lastIndex = 1; return [re.exec("\u{1f600}a"), re.lastIndex]; });
say("u empty matches step over pairs", () => "\u{1f600}a\u{1f600}".replace(/(?:)/gu, "-"));
say("empty matches do not", () => "\u{1f600}a".replace(/(?:)/g, "-"));

both("v class", /[\p{L}--[a-c]]+/v, "abcdef", "abc");
both("v intersection", /[\p{L}&&\p{ASCII}]+/v, "\xe9ab\xe9", "\xe9");
say("v strings", () => /^[\q{abc|d}x]$/v.exec("abc"));
say("v pairs", () => /[\p{Emoji_Presentation}--\u{1f600}]+/v.exec("\u{1f600}\u{1f601}\u{1f602}a"));
say("v emoji sequences", () => "\u{1f1fa}\u{1f1f8} 1️⃣".match(/\p{RGI_Emoji}/gv));

for (const [name, s] of [["8", "a1b22c333"], ["16", wide("a1b22c333")], ["pairs", "a1\u{1f600}22\u{1f600}333"]] as const) {
  say("match all " + name, () => [...s.matchAll(/\d+/g)].map(m => m[0] + "@" + m.index));
  say("match all u " + name, () => [...s.matchAll(/\P{N}+/gu)].map(m => m[0] + "@" + m.index));
  say("replace " + name, () => s.replace(/(\d)(\d*)/g, "<$2$1>"));
  say("replace with a function " + name, () => s.replace(/\D/gu, (c, at) => "[" + c.length + "@" + at + "]"));
  say("split " + name, () => s.split(/\d+/));
  say("split u " + name, () => s.split(/(?:)/u));
  say("search " + name, () => [s.search(/\d{3}/), s.search(/x/u)]);
  say("test, global " + name, () => { const re = /\d/g; const r = []; while (re.test(s)) r.push(re.lastIndex); return r; });
  say("sticky " + name, () => { const re = /\D\d+/uy; const r = []; let m; while ((m = re.exec(s))) r.push(m[0]); return [r, re.lastIndex]; });
}

say("constructed", () => [new RegExp("\\p{Lu}\\p{Ll}+", "u").exec("say Hello"), new RegExp("^.$", "u").test("\u{1f600}"), new RegExp("[a-c]+[^a-c]").exec(wide("xxabcabz"))]);
say("constructed, not in the program", () => [new RegExp("\\p{Ll}" + "{3}", "u").exec("ABcdeF"), new RegExp("^" + ".." + "$", "u").test("\u{1f600}\u{1f600}")]);

say("many times", () => {
  let n = 0;
  const subjects = ["plain", wide("plain"), "with \u{1f600}", "一二", lead, ""];
  for (let i = 0; i < 2000; i++) {
    const s = subjects[i % subjects.length];
    if (/^\p{L}+$/u.test(s)) n += 1;
    if (/\p{Extended_Pictographic}/u.test(s)) n += 10;
    if (/^.{0,5}$/u.test(s)) n += 100;
    if (/[^\x00-\x7f]/.test(s)) n += 1000;
  }
  return n;
});

const hidden = new Function("v", "return v") as <V>(v: V) => V;

function colons(text: string): string { return text.replaceAll(":", "__"); }
function dashes(text: string): string { return text.replaceAll("-", ""); }
function arrows(text: string): string { return text.replaceAll("->", " to "); }
function doubled(text: string): string { return text.replaceAll("aa", "b"); }
function wideReplacement(text: string): string { return text.replaceAll("/", "／"); }
function wideSearch(text: string): string { return text.replaceAll("日本", "JP"); }
function latinSearch(text: string): string { return text.replaceAll("é", "e"); }
function dollars(text: string): string { return text.replaceAll(":", "[$&|$$|$`|$'|$1]"); }
function lastDollar(text: string): string { return text.replaceAll(":", "$"); }
function everywhere(text: string): string { return text.replaceAll("", "."); }
function whole(text: string): string { return text.replaceAll("a:b", ""); }
function byTexts(text: string, sought: string, replacement: string): string { return text.replaceAll(sought, replacement); }
function toolName(name: string): string { return "tool__" + name.replaceAll(":", "__").replace(/[^a-zA-Z0-9_-]/g, "_"); }

const all = [colons, dashes, arrows, doubled, wideReplacement, wideSearch, latinSearch, dollars, lastDollar, everywhere, whole, toolName];
const texts = [
  "", ":", "::", "a:b", "a:b:c", "no such thing", "-a-b-", "a->b->c", "->", "aaa", "aaaa", "aaaaa", "/usr/local/bin", "日本語の日本", "café:été", "$&:$&",
  "x".repeat(70) + ":" + "y".repeat(70), "namespace:skill", "a-long-name-without-the-character-that-is-looked-for",
];
const subjects: string[] = [];
for (const text of texts) {
  subjects.push(text);
  subjects.push(hidden(text.split("").join("")));
  subjects.push(hidden(hidden(text.slice(0, 2)) + hidden(text.slice(2))));
  subjects.push(hidden(("<<" + text + ">>").split("").join("")).slice(2, -2));
  subjects.push(hidden(("日" + text).split("").join("")).slice(1));
  subjects.push(hidden(text + ":" + text).slice(0, text.length));
}

let digest = 0;
function note(text: string): void {
  for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0;
  digest = (digest * 31 + text.length) | 0;
}
const rounds = Number(process.argv[2] ?? 5);
for (let round = 0; round < rounds; round++) {
  for (const subject of subjects) {
    for (const replace of all) note(replace(subject));
    note(byTexts(subject, hidden(":"), hidden("__")));
    note(byTexts(subject, hidden("a") + hidden("a"), hidden("<") + hidden(">")));
    note(byTexts(subject, hidden(""), hidden("-")));
    note(byTexts(subject, subject, hidden("$&$&")));
  }
}
// What most calls are: a short name, a character that is not in it or is in it once.
const names = subjects.filter(subject => subject.length > 4 && subject.length < 40);
let lengths = 0;
for (let round = 0; round < rounds * 20; round++) {
  for (const name of names) lengths += colons(name).length + dashes(name).length;
}
const same = hidden("nothing to replace here".split("").join(""));
console.log(digest, lengths, colons(same) === same, colons("a:b"), dollars("a:b"), everywhere("ab"), whole("a:b") === "", toolName("plugin:skill name"));
try {
  const long = "::".repeat(1 << 14);
  byTexts(long, ":", long);
  console.log("no error");
} catch (error) {
  console.log((error as Error).name, (error as Error).message);
}

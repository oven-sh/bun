// A RegExp literal is an object wherever it stands: a constant of the module that is made when it is first read, the receiver of a method, an argument. `new RegExp` likewise, or it throws.

const WORD = /\w+/g;
const DIGITS = /^\d+$/;
const STICKY = /a/y;
const NAMED = /(?<first>\w)(?<rest>\w*)/;
const BUILT = new RegExp("[aeiou]", "gi");
const ONLY_IN_A_FUNCTION = /z+/;
const ONLY_IN_TWO_FUNCTIONS = /q(u)/;
const lines: string[] = [];
function say(...parts: unknown[]) { lines.push(parts.map(String).join(" ")); }

function count(text: string): number { return (text.match(WORD) ?? []).length; }
function isNumber(text: string): boolean { return DIGITS.test(text); }
function isNumberByLiteral(text: string): boolean { return /^\d+$/.test(text); }
function clean(text: string): string { return text.replace(/\s+/g, " ").replace(/^ | $/g, ""); }
function parts(text: string): string[] { return text.split(/,\s*/); }
function first(text: string): string | undefined { const m = /(\w)(\w*)/.exec(text); return m ? m[1] : undefined; }
function fresh(): RegExp { return /a/g; }
function source(): string { return /x+y*/i.source + "/" + /x+y*/i.flags; }
function vowels(text: string): number { BUILT.lastIndex = 0; let n = 0; while (BUILT.test(text)) n++; return n; }
function build(pattern: string, flags?: string): string { try { return String(new RegExp(pattern, flags)); } catch (error) { return (error as Error).name; } }
function zs(text: string): number { return ONLY_IN_A_FUNCTION.exec(text)?.[0].length ?? 0; }
function q(text: string): boolean { return ONLY_IN_TWO_FUNCTIONS.test(text); }
function u(text: string): string | undefined { return ONLY_IN_TWO_FUNCTIONS.exec(text)?.[1]; }
function walk(text: string): number[] { const found: number[] = []; const re = /b/g; while (re.exec(text)) found.push(re.lastIndex); return found; }

say(count("a bc def"), count(""), isNumber("123"), isNumber("12a"), isNumberByLiteral("7"), isNumberByLiteral("x"));
say(JSON.stringify(clean("  a   b  ")), parts("a, b,c").join("|"), first("hello"), first("!!"));
say(fresh() === fresh(), fresh().global, fresh().lastIndex, source());
say(vowels("education"), vowels("rhythm"), build("a+", "g"), build("("), build("a", "zz"));
say(walk("abcabcb").join());
say(zs("pizzza"), zs("none"), q("queue"), q("k"), u("quit"), u("k"));
STICKY.lastIndex = 1;
say(STICKY.test("ba"), STICKY.lastIndex, STICKY.test("ba"), STICKY.lastIndex);
const named = NAMED.exec("word");
say(named?.groups?.first, named?.groups?.rest, named?.index);
say(WORD instanceof RegExp, typeof DIGITS, Object.prototype.toString.call(BUILT), WORD.flags, String(NAMED));
let total = 0;
for (let i = 0; i < 2000; i++) total += count("a b c " + i) + (isNumber(String(i)) ? 1 : 0) + (isNumberByLiteral("x" + i) ? 1 : 0) + clean("  x  y ").length + parts("a, b,c").length + (first("hello")?.length ?? 0);
say(total);
console.log(lines.join("\n"));

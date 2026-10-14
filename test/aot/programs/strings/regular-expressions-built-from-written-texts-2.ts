// Regular expressions that a program builds from string literals at load time, as the packages marked and wrap-ansi do (second part).
// KNOWN hints1 ^(?:[*+-]|\d{1,9}[.)]) hea+ding(?: {4}| {0,3}\t)$
// KNOWN hints1 ^fi+rst(?:[*+-]|\d{1,9}[.)])second(?:[*+-]|\d{1,9}[.)])
// KNOWN hints1 ca+ret(x)[^y]
// KNOWN hints1 neste+d(?:[*+-]|\d{1,9}[.)]) hea+ding(?: {4}| {0,3}\t)$
// KNOWN hints1 [ab]joi+ned
// KNOWN hints1 do+llar$&-aa-$-b
// KNOWN hints1 repea+t ab ab ab 3
// KNOWN hints1 fro+mobject7
// KNOWN hints1 metho+d:x:y
// KNOWN hints1 ^ {0,2}facto+ry
// KNOWN hints1 sla+sh</?x
// KNOWN hints1 reu+sed:sla+sh<\/?x[/]
// KNOWN hints1 ^ {0,0}me+mo
// KNOWN hints1 ^ {0,1}me+mo
// KNOWN hints1 ^ {0,2}me+mo
// KNOWN hints1 ^ {0,3}me+mo
// KNOWN hints1 intry+x
// KNOWN hints1 afterthro+w
// KNOWN hints1 infina+lly
// KNOWN eval6 fromca+ll
// KNOWN eval6 byfu+nctionX
// KNOWN eval6 na+med
// UNKNOWN ty+peobject
// UNKNOWN ye+ar1970
// UNKNOWN lo+cale1
// UNKNOWN cha+nce0
// UNKNOWN gi+venab
declare const console: { log(...values: unknown[]): void };
function make(text: string): string { return Array.from(text).join(""); }
const other = { caret: /(^|[^\[])\^/g };
function edit(regex: string | RegExp, opt = "") {
    let source = typeof regex === "string" ? regex : regex.source;
    const obj = {
        replace: (name: string | RegExp, val: string | RegExp) => {
            let valSource = typeof val === "string" ? val : val.source;
            valSource = valSource.replace(other.caret, "$1");
            source = source.replace(name, valSource);
            return obj;
        },
        getRegex: () => new RegExp(source, opt),
    };
    return obj;
}
const bullet = /(?:[*+-]|\d{1,9}[.)])/;
const heading = edit(/^bull hea+dingcode$/).replace(/bull/g, bullet).replace("code", /(?: {4}| {0,3}\t)/).getRegex();
const twice = edit("^fi+rstbullsecondbull", "gi").replace(/bull/g, bullet).getRegex();
const caret = edit(/ca+ret(x)inner/).replace("inner", /^[^y]/).getRegex();
const nested = edit(/neste+dinner/, "m").replace("inner", heading).getRegex();
const SET = new Set(["a", "b", "a"]);
const joined = new RegExp(`[${[...SET].join("")}]joi+ned`);
const dollar = new RegExp("do+llarX-Y-Z-W".replace("X", "$$&").replace(/Y/, "a$&".replace("$&", "a")).replace(/(Z)/, "$$").replace(/(W)|(V)/, "$2b"));
const repeated = new RegExp("repea+t".concat(" ab".repeat(3), " ", String(Math.min(3, 7))));
const table = { first: "fro+m", second: { third: "object" }, list: ["x", 7] };
const fromObject = new RegExp(table.first + table.second.third + table.list[1]);
class Unused { }
const holder = { prefix: "metho+d", build(a: string, b: string) { return new RegExp([this.prefix, a, b].join(":")); } };
const byMethod = holder.build("x", "y");
const factory = (indent: number) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}facto+ry`);
const made = factory(3);
const slashed = new RegExp("sla+sh</?x");
const reused = edit(/reu+sed:inner[/]/).replace("inner", slashed).getRegex();
function memo(build: (i: number) => RegExp) { const cache: RegExp[] = []; return (indent: number) => { const i = Math.max(0, Math.min(3, indent - 1)); return cache[i] ||= build(i); }; }
const indented = memo((i) => new RegExp(`^ {0,${i}}me+mo`));
function boom(when: boolean): string { if (when) throw new Error("boom"); return "x"; }
let inTry: RegExp, afterThrow: RegExp, inFinally: RegExp | undefined;
try { inTry = new RegExp("intry+" + boom(false)); } catch { inTry = /never1/; }
try { afterThrow = new RegExp("ne+ver" + boom(true)); } catch { afterThrow = new RegExp("afterthro+w"); } finally { inFinally = new RegExp("infina+" + "lly"); }
const fromCall = new RegExp(make("fromca+ll"));
const byFunction = new RegExp("byfu+nctionx".replace("x", (m) => m.toUpperCase()));
const named = new RegExp("na+X".replace(/(?<n>X)/, "med"));
const time = new RegExp("ti+me".slice(0, Date.now() > 0 ? 5 : 1));
const typeOfHost = new RegExp("ty+pe" + typeof globalThis);
const year = new RegExp("ye+ar" + new Date(0).getUTCFullYear());
const locale = new RegExp("lo+cale" + "b".localeCompare("a"));
const chance = new RegExp("cha+nce" + Math.floor(Math.random()));
function given(text: string): RegExp { return new RegExp("gi+ven" + text); }
const fromRun = given(String(typeof globalThis).slice(0, 0) + make("ab"));
const out: unknown[] = [typeOfHost.source, year.source, locale.source, chance.source, fromRun.source, typeOfHost.test(make("typeobject")), year.test(make("yeear1970")), locale.test(make("locale1")), chance.test(make("chance1")), fromRun.test(make("givenab")), heading.source, heading.flags, twice.source, twice.flags, caret.source, nested.source, nested.flags, joined.source, dollar.source, repeated.source, fromObject.source, byMethod.source, made.source, factory(1).source, factory(9).source, fromCall.source, byFunction.source, named.source, time.source];
out.push(heading.test(make("12. heaading    ")), twice.test(make("FIIRST*SECOND9)")), caret.test(make("caaretxz")), nested.test(make("nesteed")), joined.test(make("bjoiined")), dollar.test(make("dollar")), repeated.test(make("repeaat ab ab ab 3")), fromObject.test(make("froomobject7")), byMethod.test(make("methood:x:y")), made.test(make("  factoory")), factory(1).test(make(" factoory")), fromCall.test(make("fromcaall")), byFunction.test(make("byfuunctionX")), named.test(make("naamed")), time.test(make("tiime")), typeof Unused);
out.push(slashed.source, reused.source, indented(make("ab").length).source, indented(0).source, indented(99).source, indented(3) === indented(3), inTry.source, afterThrow.source, inFinally?.source, reused.test(make("reuused:slaash</x/")), indented(2).test(make(" meemo")));
console.log(out.map(String).join(" | "));

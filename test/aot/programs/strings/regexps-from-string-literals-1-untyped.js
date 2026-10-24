// Regular expressions that a program builds from string literals at load time, as the packages marked and wrap-ansi do (the same program without type annotations).
class Unused {
}
function make(text) {
  return Array.from(text).join("");
}
const other = { caret: /(^|[^\[])\^/g };
function edit(regex, opt = "") {
  let source = typeof regex === "string" ? regex : regex.source;
  const obj = {
    replace: (name, val) => {
      let valSource = typeof val === "string" ? val : val.source;
      valSource = valSource.replace(other.caret, "$1");
      source = source.replace(name, valSource);
      return obj;
    },
    getRegex: () => new RegExp(source, opt)
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
const holder = { prefix: "metho+d", build(a, b) {
  return new RegExp([this.prefix, a, b].join(":"));
} };
const byMethod = holder.build("x", "y");
const factory = (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}facto+ry`);
const made = factory(3);
const slashed = new RegExp("sla+sh</?x");
const reused = edit(/reu+sed:inner[/]/).replace("inner", slashed).getRegex();
function memo(build) {
  const cache = [];
  return (indent) => {
    const i = Math.max(0, Math.min(3, indent - 1));
    return cache[i] ||= build(i);
  };
}
const indented = memo((i) => new RegExp(`^ {0,${i}}me+mo`));
function boom(when) {
  if (when)
    throw new Error("boom");
  return "x";
}
let inTry;
let afterThrow;
let inFinally;
try {
  inTry = new RegExp("intry+" + boom(false));
} catch {
  inTry = /never1/;
}
try {
  afterThrow = new RegExp("ne+ver" + boom(true));
} catch {
  afterThrow = new RegExp("afterthro+w");
} finally {
  inFinally = new RegExp("infina+lly");
}
const fromCall = new RegExp(make("fromca+ll"));
const byFunction = new RegExp("byfu+nctionx".replace("x", (m) => m.toUpperCase()));
const named = new RegExp("na+X".replace(/(?<n>X)/, "med"));
const time = new RegExp("ti+me".slice(0, Date.now() > 0 ? 5 : 1));
const out = [heading.source, heading.flags, twice.source, twice.flags, caret.source, nested.source, nested.flags, joined.source, dollar.source, repeated.source, fromObject.source, byMethod.source, made.source, factory(1).source, factory(9).source, fromCall.source, byFunction.source, named.source, time.source];
out.push(heading.test(make("12. heaading    ")), twice.test(make("FIIRST*SECOND9)")), caret.test(make("caaretxz")), nested.test(make("nesteed")), joined.test(make("bjoiined")), dollar.test(make("dollar")), repeated.test(make("repeaat ab ab ab 3")), fromObject.test(make("froomobject7")), byMethod.test(make("methood:x:y")), made.test(make("  factoory")), factory(1).test(make(" factoory")), fromCall.test(make("fromcaall")), byFunction.test(make("byfuunctionX")), named.test(make("naamed")), time.test(make("tiime")), typeof Unused);
out.push(slashed.source, reused.source, indented(make("ab").length).source, indented(0).source, indented(99).source, indented(3) === indented(3), inTry.source, afterThrow.source, inFinally?.source, reused.test(make("reuused:slaash</x/")), indented(2).test(make(" meemo")));
console.log(out.map(String).join(" | "));

// Regular expressions that are not literals but are still known at build time, built the way the packages ansi-regex and wrap-ansi build them, and some that are not known (the same program without type annotations).
function make(text) {
  return Array.from(text).join("");
}
function ansiRegex({ onlyFirst = false } = {}) {
  const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
  const osc = "(?:(?:\\u001B\\]|\\u009D)[^\\u0007\\u001B\\u009C\\u009D]*(?:\\u0007|\\u001B\\u005C|\\u009C))";
  const csi = "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";
  const pattern = "(?:(?:\\u001B\\]|\\u009D)[^\\u0007\\u001B\\u009C\\u009D]*(?:\\u0007|\\u001B\\u005C|\\u009C))|[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";
  return new RegExp("(?:(?:\\u001B\\]|\\u009D)[^\\u0007\\u001B\\u009C\\u009D]*(?:\\u0007|\\u001B\\u005C|\\u009C))|[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]", onlyFirst ? undefined : "g");
}
function chosen(kind) {
  return new RegExp("cho+sen", kind === 0 ? "i" : kind === 1 ? "gi" : kind === 2 ? undefined : "m");
}
function withFlags(flags) {
  return new RegExp("unkno+wnflags", flags);
}
const LONG = "lo+ng0123456789012345678901234567890123456789012345678901234567890123456789";
const SHORT = "sho+rt";
const long = new RegExp(`${LONG}|${SHORT}`);
const ESCAPE = "a";
const BELL = "c";
const C1 = "b";
const CSI = "[";
const OSC = "]";
const SGR_TERMINATOR = "m";
const CSI_INTRODUCER = `(?:${ESCAPE}\\${CSI}|${C1})`;
const CSI_PARAMETERS = "[0-?]*[ -/]*[@-~]";
const SGR_PARAMETERS = `(?<sgr>[0-9;:]*)${SGR_TERMINATOR}`;
const OSC_STRING_TERMINATOR = `(?:${BELL}|${ESCAPE}\\\\)`;
const OSC_STRING_PAYLOAD = String.raw`[^\u0000-\u001F\u007F-\u009F]*`;
const LINK_PARAMETERS = String.raw`8;(?<parameters>[^;\u0000-\u001F\u007F-\u009F]*);(?<uri>${OSC_STRING_PAYLOAD})${OSC_STRING_TERMINATOR}`;
const OSC_STRING = `${OSC_STRING_PAYLOAD}${OSC_STRING_TERMINATOR}`;
const wrapped = new RegExp(`${CSI_INTRODUCER}(?:${SGR_PARAMETERS}|${CSI_PARAMETERS})|${ESCAPE}\\${OSC}(?:${LINK_PARAMETERS}|${OSC_STRING})`, "y");
const ONE = 1;
const raw = new RegExp(String.raw`ra+w\d${ONE}\n`);
const numbered = new RegExp("nu+mber12-0.5");
let assignedText = "assi+";
for (let i = 0;i < make("x").length; i++)
  assignedText += "gned";
const assigned = new RegExp(assignedText);
const fromCall = new RegExp(make("fromca+ll"));
const SET = new Set(["a", "b"]);
const joined = new RegExp(`[${[...SET].join("")}]joi+ned`);
const object = { toString() {
  return "7";
} };
const withObject = new RegExp(`obje+ct${object}`);
const styled = make("\x1B[31mred\x1B[39m \x1B]8;;http://x\x07link\x1B]8;;\x07 \x9B1mb");
const out = [styled.replace(ansiRegex(), ""), ansiRegex({ onlyFirst: true }).exec(styled)?.index, ansiRegex().flags, ansiRegex({ onlyFirst: true }).flags];
for (let kind = 0;kind < 4; kind++)
  out.push(chosen(kind).flags + chosen(kind).test(make("x CHOOSEN")));
for (const flags of ["", "g", "i", "dgimsuy", "v"])
  out.push(withFlags(make(flags)).flags + withFlags(make(flags)).test(make("UNKNOOWNFLAGS unknoowNflags unknoownflags")));
out.push(long.exec(make("a shoort"))?.index, long.source.length, wrapped.flags, wrapped.exec(make("a[1;2m"))?.groups?.sgr, wrapped.exec(make("a]8;k=v;http://yc"))?.groups?.uri, wrapped.exec(make("x")), raw.test(make(`raaw51
`)), raw.source, numbered.test(make("nuumber12-0x5")), numbered.source);
out.push(assigned.test(make("assiigned")), fromCall.test(make("fromcaall")), joined.test(make("bjoiined")), withObject.test(make("objeect7")), CSI_INTRODUCER, LINK_PARAMETERS.length, OSC_STRING);
try {
  withFlags(make("gg"));
  out.push("no error");
} catch (e) {
  out.push(e.name);
}
console.log(out.map(String).join(" | "));

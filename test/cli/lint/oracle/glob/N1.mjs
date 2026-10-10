// N1: text that is not UTF-8: a file name on Linux, an ignore file in Latin-1. Node hands the packages a string in which what is bad is U+FFFD.
// The cases carry bytes; the judges get `Buffer.toString()` of them.
import { generator } from "./gen.mjs";
import { takes_minutes } from "./M7.mjs";
import { OPTIONS, expanded, explain as explain_fast_glob } from "./P2.mjs";
import { J, M3, P, require } from "./refs.mjs";
const m3 = require(M3 + "minimatch"), { minimatch: m10 } = require(J + "minimatch"), micromatch = require(P + "micromatch"), utils = require(P + "fast-glob/out/utils/pattern");
const packages = { npm5: require(J + "ignore"), npm705: require(P + "ignore"), npm7012: require(J + "@typescript-eslint/eslint-plugin/node_modules/ignore") };
// One bad byte each: Node makes one U+FFFD of it.
const bad = [[0xa9], [0xc3], [0xff], [0xe9], [0x80], [0xf8]];
const judges = {
  minimatch: (s, p) => m10(s, p, { dot: true }), "minimatch-nodot": (s, p) => m10(s, p), minimatch3: (s, p) => m3(s, p, { dot: true }), "minimatch3-nodot": (s, p) => m3(s, p),
  "minimatch3-makere": (s, p) => { const re = m3.makeRe(p); return re ? re.test(s) : false; }, micromatch: (s, p) => micromatch.isMatch(s, p, { dot: true }),
  "fast-glob": (s, p) => utils.matchAny(s, utils.convertPatternsToRe(expanded(p), OPTIONS)),
};
const string = it => Buffer.from(it.hex, "hex").toString();
// `E9 80`: the start of a sequence that is cut off.
const is_cut_off = it => /(?:[e0-9a-f][0-9a-f])*?(?:e[0-9a-f]|f[0-4])[89ab][0-9a-f]/.test(it.hex) && (string(it).match(/\ufffd/g) ?? []).length !== count_bad(Buffer.from(it.hex, "hex"));
// How many U+FFFD there are if each bad byte is one.
function count_bad(bytes) {
  let n = 0;
  for (let at = 0; at < bytes.length; ) {
    const b = bytes[at], len = b < 0x80 ? 1 : b < 0xc2 ? 0 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : b < 0xf5 ? 4 : 0;
    const whole = len > 0 && !bytes.subarray(at, at + len).toString().includes("\ufffd") && at + len <= bytes.length;
    const is_replacement = len === 3 && b === 0xef && bytes[at + 1] === 0xbf && bytes[at + 2] === 0xbd;
    if (!whole || is_replacement) n++;
    at += whole || is_replacement ? len : 1;
  }
  return n;
}
export function explain(it) {
  if (is_cut_off(it.pattern ?? it.lines[0]) || is_cut_off(it.path)) return "N: the start of a sequence that is cut off (`E9 80`) is one U+FFFD for Node, and one for each byte here";
  return it.mode === "fast-glob" ? explain_fast_glob({ ...it, pattern: string(it.pattern), path: string(it.path) }) : null;
}
export function* cases(seed, count) {
  const g = generator(seed), { rnd, pick } = g;
  const hex = bytes => ({ hex: Buffer.from(bytes).toString("hex") }), text = bytes => Buffer.from(bytes).toString();
  for (let k = 0; k < (count || 20000); k++) {
    const { pattern, paths } = g.pattern_and_paths();
    // A sequence from U+FFFD to a letter has 65,000 members.
    if (pattern.includes("..")) continue;
    // The letter `a` stands for what is bad: in the pattern and in the path by itself a bad byte, another one, U+FFFD, or it stays.
    const spoil = string => { const out = []; for (const byte of Buffer.from(string)) if (byte === 97 && rnd(4)) out.push(...(rnd(4) ? pick(bad) : [0xef, 0xbf, 0xbd])); else out.push(byte); return out; };
    const p = spoil(pattern);
    for (const names of paths) {
      if (takes_minutes(pattern, names)) continue;
      const s = spoil(names.join("/"));
      for (const [mode, judge] of Object.entries(judges)) { let want; try { want = judge(text(s), text(p)); } catch {} yield { it: { mode, pattern: hex(p), path: hex(s) }, want }; }
      // One line, and a path that the packages take.
      if (pattern.includes("\n") || names.some(it => it === "" || it === "." || it === "..")) continue;
      for (const [mode, ignore] of Object.entries(packages)) { let want; try { want = (ignore.default ?? ignore)().add(text(p)).ignores(text(s)); } catch {} yield { it: { mode, lines: [hex(p)], ignoreCase: true, path: hex(s), ask: "ignores" }, want }; }
    }
  }
}

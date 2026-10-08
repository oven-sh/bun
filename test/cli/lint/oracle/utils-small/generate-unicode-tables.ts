// Generates the Unicode tables of src/lint/utils/{unicode,string_utils}.rs from the ICU of the runtime that runs it:
//   bun generate-unicode-tables.ts
// General categories come from `\p{..}`. The classes of grapheme segmentation (Grapheme_Cluster_Break, Extended_Pictographic,
// Indic_Conjunct_Break) are not reachable from JavaScript, so each code point is classified by where `Intl.Segmenter` breaks
// around it in a few contexts.
const segmenter = new Intl.Segmenter("en-US");
const MAX = 0x10ffff;

function boundaries(pattern: RegExp): number[] {
  const out: number[] = [];
  let inside = false;
  for (let c = 0; c <= MAX + 1; c++) {
    const is = c <= MAX && !(c >= 0xd800 && c <= 0xdfff) && pattern.test(String.fromCodePoint(c));
    if (is !== inside) out.push(c), (inside = is);
  }
  return out;
}

const [A, EXT, ZWJ, PICT, L, V, T, RI, KA, VIRAMA] = ["a", "̀", "‍", "\u{1f600}", "ᄀ", "ᅡ", "ᆨ", "\u{1f1e6}", "क", "्"];
// Each probe: what is before the code point, what is after, and whether the break in question is the one before the last
// character of the whole (true) or the one before the code point (false).
const PROBES: [string, string, boolean][] = [
  [A, "", false], // 0
  ["", A, true], // 1
  ["", EXT, true], // 2
  [PICT, ZWJ + PICT, true], // 3
  [PICT, PICT, true], // 4
  ["", L, true], // 5
  ["", V, true], // 6
  ["", T, true], // 7
  [L, "", false], // 8
  [V, "", false], // 9
  [T, "", false], // 10
  ["", RI, true], // 11
  [PICT + ZWJ, "", false], // 12
  [KA + VIRAMA, "", false], // 13
  [KA, KA, true], // 14
  [KA, VIRAMA + KA, true], // 15
];

export const CLASSES = ["Other", "CR", "LF", "Control", "Extend", "ExtendConjunct", "Linker", "ZWJ", "RegionalIndicator", "Prepend", "SpacingMark", "L", "V", "T", "LV", "LVT", "Pictographic", "Consonant"];

export function classify(): Uint8Array {
  const classes = new Uint8Array(MAX + 1);
  const CHUNK = 0x2000;
  for (let base = 0; base <= MAX; base += CHUNK) {
    let text = "";
    const asked: number[] = [];
    for (let c = base; c < base + CHUNK; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const s = String.fromCodePoint(c);
      for (const [before, after, last] of PROBES) {
        const start = text.length;
        text += before + s + after;
        asked.push(last ? text.length - [...after].at(-1)!.length : start + before.length);
        text += "\n";
      }
    }
    const breaks = new Uint8Array(text.length + 1);
    for (const { index } of segmenter.segment(text)) breaks[index] = 1;
    let at = 0;
    for (let c = base; c < base + CHUNK; c++) {
      if (c >= 0xd800 && c <= 0xdfff) {
        classes[c] = CLASSES.indexOf("Control");
        continue;
      }
      const b = PROBES.map(() => breaks[asked[at++]] === 1);
      let name: string;
      if (c === 0xd) name = "CR";
      else if (c === 0xa) name = "LF";
      else if (b[2]) name = "Control";
      else if (!b[0]) {
        const conjunct = !b[14] ? "Linker" : !b[15] ? "Extend" : "None";
        if (!b[4]) name = "ZWJ";
        else if (!b[3]) name = conjunct === "Linker" ? "Linker" : conjunct === "Extend" ? "ExtendConjunct" : "Extend";
        else name = "SpacingMark";
        if ((name === "ZWJ" && conjunct !== "Extend") || (name === "SpacingMark" && conjunct !== "None")) throw new Error(`U+${c.toString(16)}: ${name} with InCB=${conjunct}`);
      } else if (!b[1]) name = "Prepend";
      else {
        const hangul = [b[5], b[6], b[7], b[8], b[9], b[10]].map(it => (it ? "0" : "1")).join("");
        const found = { "110100": "L", "011110": "V", "001011": "T", "011100": "LV", "001100": "LVT", "000000": "" }[hangul];
        if (found === undefined) throw new Error(`U+${c.toString(16)}: ${hangul}`);
        const all = [found, !b[11] && "RegionalIndicator", !b[12] && "Pictographic", !b[13] && "Consonant"].filter(Boolean);
        if (all.length > 1) throw new Error(`U+${c.toString(16)}: ${all}`);
        name = (all[0] as string) ?? "Other";
      }
      classes[c] = CLASSES.indexOf(name);
    }
  }
  return classes;
}

function rows(values: number[], format: (n: number) => string): string {
  let out = "";
  let line = "   ";
  for (const value of values) {
    const item = ` ${format(value)},`;
    if (line.length + item.length > 100) (out += line + "\n"), (line = "   ");
    line += item;
  }
  return out + line + "\n";
}
const hex = (n: number) => "0x" + n.toString(16).toUpperCase();

if (import.meta.main) {
  const classes = classify();
  // Hangul syllables are computed.
  const runs: number[] = [];
  let previous = -1;
  for (let c = 0; c <= MAX; c++) {
    const cls = c >= 0xac00 && c <= 0xd7a3 ? 0 : classes[c];
    if (cls !== previous) runs.push(c * 32 + cls), (previous = cls);
  }
  for (let c = 0xac00; c <= 0xd7a3; c++) {
    if (CLASSES[classes[c]] !== ((c - 0xac00) % 28 === 0 ? "LV" : "LVT")) throw new Error("Hangul");
  }
  const mark = boundaries(/^\p{M}$/u);
  const letter = boundaries(/^\p{L}$/u);
  console.log(`// Unicode ${process.versions.unicode}`);
  console.log(`static COMBINING: [u32; ${mark.length}] = [\n${rows(mark, hex)}];\n`);
  console.log(`static LETTERS: [u32; ${letter.length}] = [\n${rows(letter, hex)}];\n`);
  console.log(`static GRAPHEME_CLASSES: [u32; ${runs.length}] = [\n${rows(runs, hex)}];`);
}

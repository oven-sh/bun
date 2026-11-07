// Deterministic, seedable generator for ECMAScript regular expressions plus
// candidate input strings, used for differential testing between engines
// (bun/JSC vs node/V8). The generator builds an AST covering the full syntax
// surface, prints it, and derives inputs likely to hit both the matching and
// non-matching paths (strings synthesized by walking the AST, then mutated).
//
// Runs unchanged under bun and node. No engine-specific APIs.

// ---------------------------------------------------------------------------
// Deterministic PRNG (xorshift32) so every case is reproducible from a seed.
// ---------------------------------------------------------------------------
export function makeRng(seed) {
  let state = seed >>> 0 || 0x9e3779b9;
  return {
    next() {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state;
    },
    int(n) {
      return n <= 0 ? 0 : this.next() % n;
    },
    range(lo, hi) {
      return lo + this.int(hi - lo + 1);
    },
    pick(arr) {
      return arr[this.int(arr.length)];
    },
    chance(p) {
      return (this.next() % 10000) / 10000 < p;
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = this.int(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
  };
}

// ---------------------------------------------------------------------------
// Pattern generation. Each node knows how to print itself and how to
// synthesize a string it can match (best effort; assertions and backrefs make
// exact synthesis impossible in general, and near-misses are valuable inputs).
// ---------------------------------------------------------------------------

const LETTERS = "abcdxyz";
const DIGITS = "0123456789";
const WORDCHARS = "abcxyz09_";
const PUNCT = ".-/:";
const SPACES = " \t\n";
const NON_ASCII = "éßπΩ漢字😀é́"; // includes combining sequence
const SYNTAX_CHARS = "^$\\.*+?()[]{}|/";

function escapeForLiteral(ch) {
  return SYNTAX_CHARS.includes(ch) ? "\\" + ch : ch;
}

function escapeForClass(ch) {
  return "\\]-^".includes(ch) ? "\\" + ch : ch;
}

export class PatternBuilder {
  constructor(rng, options = {}) {
    this.rng = rng;
    this.flags = options.flags || "";
    this.unicodeMode = /[uv]/.test(this.flags);
    this.unicodeSets = this.flags.includes("v");
    this.groupCount = 0; // capturing groups defined so far
    this.namedGroups = []; // names defined so far (in order)
    this.depth = 0;
    this.maxDepth = options.maxDepth ?? 3;
    this.allowLookbehind = options.allowLookbehind !== false;
    this.allowBackrefs = options.allowBackrefs !== false;
    // Capabilities of the target engines (see capabilities.mjs); syntax an
    // engine lacks is never generated so both engines see identical cases.
    this.caps = options.capabilities || {
      unicodeSets: true,
      modifiers: true,
      duplicateNamedGroups: true,
      hasIndices: true,
      lookbehind: true,
      namedGroups: true,
      unicodeProperties: true,
      scriptProperties: true,
    };
    if (!this.caps.lookbehind) this.allowLookbehind = false;
    // Term budget keeps patterns human-triageable; a few cases are large on purpose.
    this.termsLeft = options.termBudget ?? 24;
  }

  // Returns { source, sample } where sample is a string the term can match.
  disjunction() {
    const altCount = this.rng.pick([1, 1, 1, 1, 2, 2, 3, 4]);
    const alts = [];
    for (let i = 0; i < altCount; i++) alts.push(this.alternative());
    const chosen = this.rng.pick(alts);
    return { source: alts.map(a => a.source).join("|"), sample: chosen.sample };
  }

  alternative() {
    const termCount = this.rng.pick([0, 1, 1, 2, 2, 2, 3, 3]);
    let source = "";
    let sample = "";
    for (let i = 0; i < termCount; i++) {
      if (this.termsLeft <= 0) break;
      this.termsLeft--;
      const term = this.term();
      source += term.source;
      sample += term.sample;
    }
    return { source, sample };
  }

  term() {
    const rng = this.rng;
    const atLimit = this.depth >= this.maxDepth;
    const kinds = ["char", "char", "class", "predefined", "dot", "group", "assertion"];
    if (this.allowBackrefs && (this.groupCount > 0 || this.namedGroups.length > 0)) kinds.push("backref");
    let kind = rng.pick(kinds);
    if (atLimit && kind === "group") kind = "char";
    switch (kind) {
      case "char":
        return this.quantify(this.character());
      case "class":
        return this.quantify(this.characterClass());
      case "predefined":
        return this.quantify(this.predefined());
      case "dot":
        return this.quantify({ source: ".", sample: rng.pick("abxz0-".split("")) });
      case "group":
        return this.quantify(this.group());
      case "assertion":
        return this.assertion();
      case "backref":
        return this.quantify(this.backreference());
    }
    return this.quantify(this.character());
  }

  character() {
    const rng = this.rng;
    const bucket = rng.pick(["letter", "letter", "letter", "digit", "punct", "space", "nonascii", "escape"]);
    switch (bucket) {
      case "letter": {
        const ch = rng.pick(LETTERS.split(""));
        return { source: escapeForLiteral(ch), sample: ch };
      }
      case "digit": {
        const ch = rng.pick(DIGITS.split(""));
        return { source: ch, sample: ch };
      }
      case "punct": {
        const ch = rng.pick(PUNCT.split(""));
        return { source: escapeForLiteral(ch), sample: ch };
      }
      case "space": {
        const ch = rng.pick(SPACES.split(""));
        // spaces are literal in patterns
        return { source: ch === "\n" ? "\\n" : ch === "\t" ? "\\t" : ch, sample: ch };
      }
      case "nonascii": {
        const ch = rng.pick([...NON_ASCII]);
        return { source: ch, sample: ch };
      }
      case "escape": {
        // control / hex / unicode escapes
        const pick = rng.pick([
          "\\t",
          "\\n",
          "\\r",
          "\\f",
          "\\v",
          "\\x41",
          "\\u0062",
          this.unicodeMode ? "\\u{63}" : "\\u0063",
          "\\0",
        ]);
        const map = {
          "\\t": "\t",
          "\\n": "\n",
          "\\r": "\r",
          "\\f": "\f",
          "\\v": "\v",
          "\\x41": "A",
          "\\u0062": "b",
          "\\u{63}": "c",
          "\\u0063": "c",
          "\\0": "\0",
        };
        return { source: pick, sample: map[pick] };
      }
    }
    return { source: "a", sample: "a" };
  }

  predefined() {
    const rng = this.rng;
    const options = [
      ["\\d", () => rng.pick(DIGITS.split(""))],
      ["\\D", () => rng.pick("ax_ .".split(""))],
      ["\\w", () => rng.pick(WORDCHARS.split(""))],
      ["\\W", () => rng.pick(" .-!:".split(""))],
      ["\\s", () => rng.pick(SPACES.split(""))],
      ["\\S", () => rng.pick("ax0._".split(""))],
    ];
    if (this.unicodeMode && this.caps.unicodeProperties) {
      options.push(["\\p{L}", () => rng.pick("aZéπ漢".split(""))]);
      options.push(["\\P{L}", () => rng.pick("09 .!".split(""))]);
      options.push(["\\p{ASCII_Hex_Digit}", () => rng.pick("0af9AF".split(""))]);
      if (this.caps.scriptProperties) options.push(["\\p{Script=Greek}", () => rng.pick("πΩλ".split(""))]);
    }
    const [source, gen] = rng.pick(options);
    return { source, sample: gen() };
  }

  characterClass() {
    const rng = this.rng;
    const negated = rng.chance(0.25);
    const partCount = rng.range(1, 4);
    const parts = [];
    const positives = []; // chars the class contains
    for (let i = 0; i < partCount; i++) {
      const kind = rng.pick(["char", "range", "predef", "char"]);
      if (kind === "range") {
        const ranges = [
          ["a", "f", "abcdef"],
          ["0", "9", "0123456789"],
          ["x", "z", "xyz"],
          ["A", "Z", "ABCXYZ"],
        ];
        const [lo, hi, members] = rng.pick(ranges);
        parts.push(`${lo}-${hi}`);
        positives.push(...members.split(""));
      } else if (kind === "predef") {
        const pd = rng.pick([
          ["\\d", "057"],
          ["\\w", "ax9_"],
          ["\\s", " \t"],
        ]);
        parts.push(pd[0]);
        positives.push(...pd[1].split(""));
      } else {
        const ch = rng.pick("abcxyz09.-_é".split(""));
        parts.push(escapeForClass(ch));
        positives.push(ch);
      }
    }
    // v-mode extras: nested class, string literals, set operations.
    let source;
    let sample;
    if (this.unicodeSets && rng.chance(0.35)) {
      const other = "[" + rng.pick(["abc", "b-d", "\\d", "xyz"]) + "]";
      const op = rng.pick(["--", "&&", ""]);
      const stringDisj = rng.chance(0.3) ? "\\q{" + rng.pick(["ab", "abc", "xy", "z"]) + "}" : "";
      source = "[" + (negated ? "^" : "") + "[" + parts.join("") + "]" + op + other + stringDisj + "]";
      // Sample synthesis for set operations is unreliable; use a member or a miss.
      sample = negated ? "%" : positives.length ? rng.pick(positives) : "a";
    } else {
      source = "[" + (negated ? "^" : "") + parts.join("") + "]";
      sample = negated ? "%" : positives.length ? rng.pick(positives) : "a";
    }
    return { source, sample };
  }

  group() {
    const rng = this.rng;
    this.depth++;
    const kind = rng.pick(["capture", "capture", "noncapture", "noncapture", "named", "modifier"]);
    let open;
    let capturing = false;
    if (kind === "capture") {
      open = "(";
      capturing = true;
      this.groupCount++;
    } else if (kind === "named") {
      const name = rng.pick(["a", "b", "grp", "x1", "π"].filter(n => !this.namedGroups.includes(n)));
      if (name === undefined) {
        open = "(";
        capturing = true;
        this.groupCount++;
      } else {
        open = `(?<${name}>`;
        capturing = true;
        this.groupCount++;
        this.namedGroups.push(name);
      }
    } else if (kind === "modifier" && this.caps.modifiers && rng.chance(0.5)) {
      // inline modifiers (?i:) (?m:) (?s:) (?-i:) etc.
      const add = rng.pick(["i", "m", "s", "im", ""]);
      const remove = add === "" ? rng.pick(["i", "m", "s"]) : rng.chance(0.3) ? "s" : "";
      const removePart = remove && !add.includes(remove) ? "-" + remove : "";
      if (add || removePart) open = `(?${add}${removePart}:`;
      else open = "(?:";
    } else {
      open = "(?:";
    }
    const inner = this.disjunction();
    this.depth--;
    // A group whose content already loops unboundedly must not itself get an
    // unbounded quantifier: that is the nested-quantifier catastrophic
    // backtracking shape (e.g. /(a+|b)+c/ on a long non-matching input),
    // where engines legitimately differ only in HOW LONG they take. Mark the
    // atom so quantify() keeps it bounded.
    return { source: open + inner.source + ")", sample: inner.sample, loops: /[*+]|\{\d+,\}/.test(inner.source) };
  }

  assertion() {
    const rng = this.rng;
    const kind = rng.pick(["^", "$", "\\b", "\\B", "lookahead", "neglookahead", "lookbehind", "neglookbehind", "\\b"]);
    if (kind === "^" || kind === "$" || kind === "\\b" || kind === "\\B") return { source: kind, sample: "" };
    if ((kind === "lookbehind" || kind === "neglookbehind") && !this.allowLookbehind)
      return { source: "\\b", sample: "" };
    this.depth++;
    const inner = this.depth > this.maxDepth ? { source: "a", sample: "a" } : this.disjunction();
    this.depth--;
    switch (kind) {
      case "lookahead":
        // Sample: the asserted text should follow; contribute it (the next
        // terms will overlap it in practice, giving near-miss inputs too).
        return { source: `(?=${inner.source})`, sample: "" };
      case "neglookahead":
        return { source: `(?!${inner.source})`, sample: "" };
      case "lookbehind":
        return { source: `(?<=${inner.source})`, sample: "" };
      case "neglookbehind":
        return { source: `(?<!${inner.source})`, sample: "" };
    }
    return { source: "\\b", sample: "" };
  }

  backreference() {
    const rng = this.rng;
    if (this.namedGroups.length && rng.chance(0.4)) {
      const name = rng.pick(this.namedGroups);
      return { source: `\\k<${name}>`, sample: "" };
    }
    const n = rng.range(1, this.groupCount);
    // Print with a guard so a following digit doesn't merge into the number
    // (e.g. \1 followed by literal 2). Using a group boundary keeps it exact.
    return { source: `(?:\\${n})`, sample: "" };
  }

  quantify(atom) {
    const rng = this.rng;
    if (!rng.chance(0.45)) return atom;
    // See group(): atoms that already loop internally only ever get bounded
    // quantifiers, keeping cases out of the exponential-backtracking regime.
    // An atom that already loops unboundedly must not itself be repeated:
    // even a bounded repeat of an unbounded loop backtracks exponentially when
    // it fails, and that is a performance surface, not a correctness one.
    const boundedOnly = atom.loops === true;
    const quant = rng.pick(
      boundedOnly ? ["?", "?", "{0}", "{1}", "{0,1}"] : ["*", "+", "?", "?", "{2}", "{0,2}", "{1,3}", "{2,}", "{0}"],
    );
    const lazy = rng.chance(0.25) ? "?" : "";
    let sample = atom.sample;
    switch (quant) {
      case "*":
        sample = rng.pick(["", atom.sample, atom.sample + atom.sample]);
        break;
      case "+":
        sample = rng.pick([atom.sample, atom.sample + atom.sample, atom.sample.repeat(3)]);
        break;
      case "?":
        sample = rng.pick(["", atom.sample]);
        break;
      case "{2}":
        sample = atom.sample + atom.sample;
        break;
      case "{0,2}":
        sample = rng.pick(["", atom.sample, atom.sample + atom.sample]);
        break;
      case "{1,3}":
        sample = rng.pick([atom.sample, atom.sample + atom.sample, atom.sample.repeat(3)]);
        break;
      case "{2,}":
        sample = rng.pick([atom.sample.repeat(2), atom.sample.repeat(3)]);
        break;
      case "{0}":
        sample = "";
        break;
    }
    const needsGrouping = atom.source.length > 1 && !/^(\(.*\)|\[.*\]|\\.|\\[pPu]\{[^}]*\})$/s.test(atom.source);
    const source = (needsGrouping ? `(?:${atom.source})` : atom.source) + quant + lazy;
    return { source, sample };
  }
}

// ---------------------------------------------------------------------------
// Flags. Each generated pattern gets one flag string; invalid combinations
// (u with v) are excluded here and covered separately by the error corpus.
// ---------------------------------------------------------------------------
export const FLAG_SETS = [
  "",
  "g",
  "i",
  "m",
  "s",
  "u",
  "v",
  "y",
  "d",
  "gi",
  "gm",
  "ims",
  "gy",
  "gd",
  "iu",
  "iv",
  "msy",
  "gimsy",
  "dgimsuy",
  "givms",
];

// ---------------------------------------------------------------------
// Input synthesis: from the AST sample plus mutations and adversarial edges.
// ---------------------------------------------------------------------
export function synthesizeInputs(rng, sample) {
  const inputs = new Set();
  inputs.add(sample);
  inputs.add("");
  inputs.add(sample + sample);
  inputs.add("prefix " + sample + " suffix");
  inputs.add(sample.toUpperCase());
  inputs.add(sample.split("").reverse().join(""));
  // mutations: delete / substitute / insert one character
  if (sample.length) {
    const i = rng.int(sample.length);
    inputs.add(sample.slice(0, i) + sample.slice(i + 1));
    inputs.add(sample.slice(0, i) + rng.pick("axz09 .-\n".split("")) + sample.slice(i + 1));
    inputs.add(sample.slice(0, i) + rng.pick("axz09 .-\n".split("")) + sample.slice(i));
  }
  // fixed adversarial edges: newlines (multiline), boundaries, non-ASCII, surrogates
  inputs.add("\n" + sample + "\n");
  inputs.add("aa" + sample);
  inputs.add(rng.pick(["日本語", "café", "😀😀", "\ud800", "\udfff", "é", "aA0!  \t\n"]) + sample);
  return [...inputs].slice(0, 8);
}

// ---------------------------------------------------------------------
// Case generation.
// ---------------------------------------------------------------------
export function generateCases(seed, count, options = {}) {
  const rng = makeRng(seed);
  const caps = options.capabilities;
  const flagSets = FLAG_SETS.filter(f => {
    if (!caps) return true;
    if (!caps.unicodeSets && f.includes("v")) return false;
    if (!caps.hasIndices && f.includes("d")) return false;
    return true;
  });
  const cases = [];
  for (let i = 0; i < count; i++) {
    const flags = options.flags ?? rng.pick(flagSets);
    // Occasionally allow a much larger pattern to stress limits and layout.
    const large = rng.chance(0.03);
    const builder = new PatternBuilder(rng, {
      flags,
      maxDepth: options.maxDepth ?? (large ? 5 : 3),
      termBudget: options.termBudget ?? (large ? 120 : 24),
      capabilities: caps,
    });
    let node = builder.disjunction();
    let source = node.source;
    if (source === "") source = "(?:)"; // empty pattern is valid but keep it visible
    const inputs = synthesizeInputs(rng, node.sample);
    cases.push({ source, flags, inputs });
  }
  return cases;
}

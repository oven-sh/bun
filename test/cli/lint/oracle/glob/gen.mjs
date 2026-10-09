// The generators that the oracles share. All are seeded: the same seed gives the same cases.
export function random(seed) {
  const rnd = n => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) % n; };
  return { rnd, pick: a => a[rnd(a.length)] };
}

// That of stage0.js: a path, and a pattern made of it by putting magic where it may still match. Extglobs nested to 3, POSIX classes,
// sequences, `.`, `..` and empty names.
export function generator(seed) {
  const { rnd, pick } = random(seed);
  const names = ["a", "b", "ab", "abc", "aab", "d", "src", "a.b", "a-b", ".x", ".a", ".", "..", "a1", "B", "é", "aé", "😀", "a b", "{a}", "a,b", "[a]", "(a)", "!a", "+a", "a}", "index.ts", "a.test.tsx", "a.d.ts", "a.js", "@scope", "~", "", "a\nb", "1", "12"];
  const ext = depth => {
    const alt = () => { const r = rnd(10); return r < 4 ? pick(names) : r < 5 ? "" : r < 6 ? "*" : r < 7 ? pick(names) + "*" : r < 8 && depth < 3 ? ext(depth + 1) : r < 9 && depth < 3 ? pick(names) + ext(depth + 1) + pick(["", ".js", "*"]) : "?"; };
    return pick(["+", "@", "?", "*", "!", "!", ""]) + "(" + Array.from({ length: 1 + rnd(3) }, alt).join("|") + ")";
  };
  const magic = s => {
    const r = rnd(22), i = rnd(s.length + 1), j = Math.min(s.length, i + 1 + rnd(2));
    switch (r) {
      case 0: return s.slice(0, i) + "*" + s.slice(j);
      case 1: return s.slice(0, i) + "?" + s.slice(i + 1);
      case 2: return s.slice(0, i) + "[" + (s[i] ?? "a") + pick(["", "b", "-z", "x-z", "/", ",-z"]) + "]" + s.slice(i + 1);
      case 3: return s.slice(0, i) + "[" + pick(["!", "^"]) + pick(["q", "a", "a-c"]) + "]" + s.slice(i + 1);
      case 4: return "{" + s + "," + pick(names) + "}";
      case 5: return s.slice(0, i) + "{" + s.slice(i, j) + "," + pick(["", "z", "*", "{y," + s.slice(i, j) + "}"]) + "}" + s.slice(j);
      case 6: return "*" + s.slice(i);
      case 7: return s.slice(0, i) + "*";
      case 8: return s.slice(0, i) + "\\" + s.slice(i);
      case 9: return s.slice(0, i) + "**" + s.slice(j);
      case 10: return "*";
      case 11: case 12: case 13: return s.slice(0, i) + ext(0) + s.slice(j);
      case 14: return ext(0) + ext(0) + pick(["", ".js"]);
      case 15: return s.slice(0, i) + pick(["{", "}", "[", "]", ",", "!", "\\", "(", ")", "|", "+", "@", '"', "$", "^", "."]) + s.slice(i);
      case 16: return s.slice(0, i) + "[[:" + pick(["alpha", "digit", "alnum", "upper", "lower", "space", "punct", "word", "xdigit", "graph", "print", "blank", "cntrl", "ascii", "nope"]) + ":]" + pick(["", "x", "-"]) + "]" + s.slice(i + 1);
      case 17: return "{" + pick(["1..3", "a..c", "01..10", "3..1", "1..9..2", "a..e..2", "-1..1"]) + "}";
      default: return s;
    }
  };
  const mutate = parts => {
    const p = parts.slice(), r = rnd(8);
    if (r === 0) p.splice(rnd(p.length), 1); else if (r === 1) p.splice(rnd(p.length + 1), 0, pick(names)); else if (r === 2) p[rnd(p.length)] = pick(names);
    else if (r === 3) p[rnd(p.length)] += pick(["a", ".js", "b", "/"]);
    return p;
  };
  // A string cut in the middle of a pair is no text that a file system or a configuration can hold.
  const whole = s => s.isWellFormed();
  const pattern_and_paths = () => {
    for (;;) {
      const parts = Array.from({ length: 1 + rnd(4) }, () => pick(names));
      const p = parts.map(x => (rnd(2) ? magic(x) : x));
      if (rnd(3) === 0) p.splice(rnd(p.length + 1), rnd(2), "**");
      let pattern = p.join("/");
      if (rnd(12) === 0) pattern = "!" + pattern;
      if (rnd(10) === 0) pattern = "**/" + pattern;
      if (rnd(10) === 0) pattern += "/**";
      const paths = [parts, mutate(parts), mutate(mutate(parts))];
      if (whole(pattern)) return { pattern, paths };
    }
  };
  return { rnd, pick, names, pattern_and_paths, magic, mutate, ext };
}

// Files of 1 to 3 lines of an ignore file, and a path that has a chance: fuzz-gen.js of the evaluation, with `\x`, POSIX classes, `[a*]`,
// blanks, a byte order mark, `\r` and comments added. And `near`: paths that just miss (mut.js of the evaluation).
export function ignore_generator(seed, { plain = false, more_lines = false } = {}) {
  const { rnd, pick } = random(seed);
  const names = ["a", "b", "ab", "abc", "d", "e", "x", "src", "lib", "a.b", "a-b", ".x", ".a", "test", "a1", "B", "Ab", "é", "aé", "a b", "{a}", "a,b", "[a]", "(a)", "!a", "#a", "+a", "a}"];
  const magic = s => {
    const r = rnd(plain ? 12 : 17), i = rnd(s.length + 1), j = Math.min(s.length, i + 1 + rnd(2));
    switch (r) {
      case 0: return s.slice(0, i) + "*" + s.slice(j);
      case 1: return s.slice(0, i) + "?" + s.slice(i + 1);
      case 2: return s.slice(0, i) + "[" + (s[i] ?? "a") + pick(["", "b", "-z", "x-z"]) + "]" + s.slice(i + 1);
      case 3: return s.slice(0, i) + "[" + pick(["!", "^"]) + pick(["q", "a", "a-c"]) + "]" + s.slice(i + 1);
      case 4: return "{" + s + "," + pick(names) + "}";
      case 5: return s.slice(0, i) + "{" + s.slice(i, j) + "," + pick(["", "z", "*"]) + "}" + s.slice(j);
      case 6: return "*" + s.slice(i);
      case 7: return s.slice(0, i) + "*";
      case 8: return s.slice(0, i) + "\\" + s.slice(i);
      case 9: return s.slice(0, i) + "**" + s.slice(j);
      case 10: return "*";
      case 12: return s.slice(0, i) + "[[:" + pick(["alpha", "digit", "alnum", "upper", "lower", "space", "punct", "xdigit", "graph", "print", "blank", "cntrl", "word", "nope"]) + ":]" + pick(["", "x", "-"]) + "]" + s.slice(i + 1);
      case 13: return s.slice(0, i) + "[" + (s[i] ?? "a") + pick(["*", "?", "*]", "\\]", "/", ",-z", "\\", "]", "-", "\\d", "\\w"]) + pick(["", "]"]) + s.slice(i + 1);
      case 14: return s.slice(0, i) + pick(["\\d", "\\w", "\\s", "\\b", "\\n", "\\t", "\\1", "\\x41", "\\\\", "\\*", "\\?", "\\[", "\\ ", "\\/", "\\.", "$", "^", "|", "+", "(", ")", "{", "}", "]", "["]) + s.slice(j);
      case 15: return s.toUpperCase();
      default: return s;
    }
  };
  const file_of_lines = () => {
    for (;;) {
      const depth = 1 + rnd(4);
      const parts = Array.from({ length: depth }, () => pick(names));
      parts[depth - 1] += ".js";
      const lines = [];
      for (let n = 1 + (rnd(more_lines ? 2 : 4) === 0 ? 1 + rnd(2) : 0); n > 0; n--) {
        const from = rnd(depth), to = from + 1 + rnd(depth - from);
        const p = parts.slice(from, to).map(x => (rnd(2) ? magic(x) : x));
        if (rnd(4) === 0) p.splice(rnd(p.length + 1), rnd(2), "**");
        let line = p.join("/");
        if (rnd(5) === 0) line = "/" + line;
        if (rnd(6) === 0) line += "/";
        if (rnd(5) === 0) line = "**/" + line;
        if (rnd(8) === 0) line += "/**";
        if (lines.length && rnd(2)) line = "!" + line;
        if (!plain) {
          if (rnd(25) === 0) line += pick([" ", "  ", "\t", "\\ ", "\\  ", " \\ ", "\\"]);
          if (rnd(60) === 0) line = pick(["#", "\\#", "\\!", "!!", " ", "﻿"]) + line;
        }
        lines.push(line);
      }
      if (lines.some(l => l.includes("\0") || l.includes("\n") || !l.isWellFormed())) continue;
      return { lines, path: parts.join("/") };
    }
  };
  const near = p => {
    const out = new Set(), parts = p.split("/");
    for (let i = 0; i < p.length; i++) {
      if (p[i] !== "/") out.add(p.slice(0, i) + "/" + p.slice(i + 1));
      else { out.add(p.slice(0, i) + p.slice(i + 1)); out.add(p.slice(0, i) + "x" + p.slice(i + 1)); }
    }
    for (let i = 0; i < parts.length; i++) { out.add(parts.toSpliced(i, 1).join("/")); out.add(parts.toSpliced(i, 0, "q").join("/")); out.add(parts.toSpliced(i, 0, parts[i]).join("/")); }
    return [...out].filter(x => x && x.isWellFormed());
  };
  return { rnd, pick, names, file_of_lines, near };
}

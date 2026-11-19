// Small changes to formatted code. Most results aren't formatted, many aren't valid, and some are both.

export function random(seed: number) {
  return (below: number) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let it = Math.imul(seed ^ (seed >>> 15), seed | 1);
    it ^= it + Math.imul(it ^ (it >>> 7), it | 61);
    return ((it ^ (it >>> 14)) >>> 0) % below;
  };
}

// prettier-ignore
const snippets = [
  " ", "  ", "\t", "\n", "\n\n", "(", ")", ",", ";", "{", "}", "[", "]", "!", "?", "?.", ".", ":", "=", "=>", "...", "*", "#", "@",
  "-", "+", "++", "| ", "& ", '"', "'", "`", "\\", "0", "1n", "0X1", "1.0", "1e5", ".5", "/x/", "x", "é", "aaaaaaaa",
  "aaaaaaaaaaaaaaaaaaaa", "{}", "[]", "()", '{" "}', "<a />", "<></>", "<T>", "<T,>", " ?? a", " || a", " && a", " + a",
  " ** 2", " in a", " ? a : b", " as T", " as const", " satisfies T", " is T", ": T", "?: T", "a = 1", "label: ", "this",
  "super", "null", "arguments", "eval", "constructor", "return;\n", "break;\n", "continue;\n", '"use strict";\n',
  ..."async await yield new static readonly export default declare abstract const let type get set private public override accessor keyof typeof infer unique extends implements function class enum interface namespace import from of else void delete asserts using with"
    .split(" ").map(it => it + " "),
];

// prettier-ignore
const comments = [
  "// c", "/* c */", "/** c */", "/* @__PURE__ */", "// a\n// b", "// a\n\n// b", "/* a */ /* b */", "/* a */ // b", "/* a\nb */",
  "/**\n * a\n */", "/** @type {T} */", "/* GraphQL */", "/* HTML */", "// prettier-ignore", "/* prettier-ignore */",
  "// oxfmt-ignore", "// cccccccccccccccccccccccccccccccccccccccccccccccccc",
];

function closing(text: string, start: number) {
  for (let at = start, depth = 0; at < text.length; at++) {
    if ("([{".includes(text[at])) depth++;
    else if (")]}".includes(text[at]) && --depth === 0) return at;
  }
  return -1;
}

export function mutate(text: string, next: (below: number) => number): string {
  const pick = <T>(list: T[]) => list[next(list.length)];
  const tokens = Array.from(text.matchAll(/[\w$]+| +|[^]/g), it => it.index).concat(text.length);
  const index = next(tokens.length - 1);
  const [start, end] = [tokens[index], tokens[index + 1]];
  const later = (most: number) => tokens[Math.min(index + 1 + next(most), tokens.length - 1)];
  const splice = (from: number, to: number, it: string) => text.slice(0, from) + it + text.slice(to);
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = text.indexOf("\n", start);
  const indentation = /^[ \t]*/.exec(text.slice(lineStart))![0];
  const newLine = "\n" + indentation + pick(["", "  "]);
  const gapEnd = text[start] === " " ? end : start;
  const find = (pattern: RegExp) => start + text.slice(start).search(pattern);

  switch (next(15)) {
    case 0:
      return splice(start, start, pick(snippets));
    case 1:
      return splice(start, end, pick(snippets));
    case 2:
      return splice(start, end, "");
    case 3:
      return splice(start, later(30), "");
    case 4: {
      const other = next(tokens.length - 1);
      return splice(start, end, text.slice(tokens[other], tokens[other + 1]));
    }
    case 5:
      return text.slice(0, lineEnd) + text.slice(lineEnd).replace(/^\n[ \t]*/, pick([" ", ""]));
    case 6:
      return splice(start, gapEnd, newLine);
    case 7: {
      const last = later(12);
      return splice(start, last, `(${text.slice(start, last)})`);
    }
    case 8: {
      const [open, close] = [find(/\(/), closing(text, find(/\(/))];
      return open < start || close < 0 ? text : splice(open, close + 1, text.slice(open + 1, close));
    }
    case 9: {
      const [open, close] = [find(/[([{]/), closing(text, find(/[([{]/))];
      if (open < start || close < 0) return text;
      const inside = text
        .slice(open, close + 1)
        .replace(/,?\n\s*(?=[)\]])|(?<=[([])\n\s*|\n\s*(?=\.)/g, "")
        .replace(/,?\n\s*(?=})|\n\s*/g, " ");
      return splice(open, close + 1, inside);
    }
    case 10:
      return splice(lineStart, lineStart, indentation + pick(comments).replaceAll("\n", "\n" + indentation) + "\n");
    case 11: {
      const at = /[,;]/.test(text[lineEnd - 1]) && next(2) ? lineEnd - 1 : lineEnd;
      return splice(at, at, " " + pick(comments));
    }
    case 12: {
      const comment = pick(comments);
      const after = comment.includes("//") ? newLine : pick([newLine, " "]);
      return splice(start, gapEnd, pick([newLine, " "]) + comment.replaceAll("\n", newLine) + after);
    }
    case 13: {
      const nextEnd = text.indexOf("\n", lineEnd + 1);
      if (nextEnd < 0) return text;
      return splice(lineStart, nextEnd, text.slice(lineEnd + 1, nextEnd) + "\n" + text.slice(lineStart, lineEnd));
    }
    default: {
      const name = find(/[A-Za-z]{2}/);
      if (name < start) return text;
      return next(2) ? splice(name + 1, name + 1, "x".repeat(1 + next(30))) : splice(name, name + 1, "");
    }
  }
}

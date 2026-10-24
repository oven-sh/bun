function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function size(s: string): number {
  return s.length;
}

function shout(s: string): string {
  return s + "!";
}

class Token {
  text: string;
  constructor(text: string) {
    this.text = text;
  }
  size(): number {
    return this.text.length;
  }
  shout(): string {
    return this.text + "!";
  }
}

function firstGroup(pattern: RegExp, text: string): string {
  const match = pattern.exec(text);
  if (match === null) return "no match";
  return match[1];
}

function namedGroup(pattern: RegExp, text: string): string {
  const groups = pattern.exec(text)?.groups;
  if (groups === undefined) return "no groups";
  return groups.name;
}

function pieces(pattern: RegExp, text: string): string[] {
  return text.split(pattern);
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += size(firstGroup(/(a)/, "a")) + size(namedGroup(/(?<name>a)/, "a")) + pieces(/(,)/, "a,b").length + new Token(firstGroup(/(a)/, "a")).size();
console.log("2000 honest rounds: " + warm);

attempt("split, the group took part", () => pieces(/(,)/, "a,b"));
attempt("split, the group took no part", () => pieces(/(;)?,/, "a,b"));
attempt("split, sizes", () => pieces(/(;)?,/, "a,b").map(size));
attempt("split, joined", () => pieces(/(;)?,/, "a,b").map(shout));
attempt("split, join", () => pieces(/(;)?,/, "a,b").join("|"));
attempt("split, a loop", () => {
  let all = "";
  for (const piece of pieces(/(;)?,/, "a,b,c")) all += piece;
  return all;
});

attempt("match all", () => Array.from("b ab".matchAll(/(a)?b/g), match => shout(match[1])));
attempt("match without the flag", () => {
  const match = "b".match(/(a)?(b)/);
  return match === null ? "none" : [match[1], match[2], match.length, 1 in match];
});
attempt("destructured", () => {
  const [, first, second]: string[] = /(a)?(b)/.exec("b") ?? [];
  return [shout(first), shout(second)];
});
attempt("a character past the end", () => {
  const text = "ab";
  const c: string = text[5];
  return [c, shout(c), typeof c];
});
attempt("a character past the end, its size", () => size("ab"[5]));
attempt("an operand of the program that is not there", () => {
  const operand: string = process.argv[99];
  return [operand, shout(operand)];
});

console.log("honest again: " + [firstGroup(/(a)/, "a"), namedGroup(/(?<name>a)/, "a"), pieces(/(,)/, "a,b").join("")].join(" "));

export {};

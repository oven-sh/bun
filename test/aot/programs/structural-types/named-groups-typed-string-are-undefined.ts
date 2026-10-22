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

attempt("named, took part", () => shout(namedGroup(/(?<name>a)b/, "ab")));
attempt("named, took no part", () => shout(namedGroup(/(?<name>a)?b/, "b")));
attempt("named, took no part, its size", () => size(namedGroup(/(?<name>a)?b/, "b")));
attempt("named, another name", () => shout(namedGroup(/(?<other>a)b/, "ab")));
attempt("named, the keys", () => Object.keys(/(?<name>a)?(?<other>b)/.exec("b")?.groups ?? {}));

console.log("honest again: " + [firstGroup(/(a)/, "a"), namedGroup(/(?<name>a)/, "a"), pieces(/(,)/, "a,b").join("")].join(" "));

export {};

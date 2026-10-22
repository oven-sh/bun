function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

namespace Board {
  export let score: number = 0;
  export let title: string = "start";
  export let maybe: number | undefined;
  export let flag: boolean = false;
  export function assign(n: number): number {
    return (score = n);
  }
  export function raise(): number[] {
    return [score++, ++score, score--, --score];
  }
  export function compound(): number[] {
    return [(score += 5), (score -= 1), (score *= 2), (score /= 4), (score **= 2), (score %= 7), (score <<= 2), (score |= 1)];
  }
  export function logical(): unknown[] {
    return [(maybe ??= 3), (maybe ??= 4), (flag ||= true), (flag &&= false)];
  }
  export function fromList(list: [number, string]): void {
    [score, title] = list;
  }
  export function fromObject(from: { score: number; title: string }): void {
    ({ score, title } = from);
  }
  export function fromObjectByOtherNames(from: { a: number; b: string }): void {
    ({ a: score, b: title } = from);
  }
  export function withDefaults(from: { score?: number }): void {
    ({ score = 99 } = from);
  }
  export function loopOf(list: number[]): number {
    let rounds = 0;
    for (score of list) rounds++;
    return rounds;
  }
  export function loopIn(from: Record<string, number>): number {
    let rounds = 0;
    for (title in from) rounds++;
    return rounds;
  }
  export function shorthand(): { score: number; title: string } {
    return { score, title };
  }
  export function inClosure(): () => number {
    return () => ++score;
  }
  export function shadowed(score: number): number {
    score++;
    return score;
  }
}

function state(): unknown[] {
  return [Board.score, Board.title, Board.maybe, Board.flag];
}

show("at first", () => state());
show("=", () => [Board.assign(4), state()]);
show("++ and --", () => [Board.raise(), state()]);
show("compound", () => [Board.compound(), state()]);
show("logical", () => [Board.logical(), state()]);
show("taken apart from a list", () => [Board.fromList([7, "list"]), state()]);
show("taken apart from an object", () => [Board.fromObject({ score: 8, title: "object" }), state()]);
show("taken apart by other names", () => [Board.fromObjectByOtherNames({ a: 9, b: "names" }), state()]);
show("taken apart with a default", () => [Board.withDefaults({}), state()]);
show("for of", () => [Board.loopOf([1, 2, 3]), state()]);
show("for in", () => [Board.loopIn({ k: 1, last: 2 }), state()]);
show("shorthand", () => Board.shorthand());
show("in a closure", () => [Board.inClosure()(), state()]);
show("a parameter of the same name", () => [Board.shadowed(50), state()]);
show("from outside", () => {
  Board.score = 1.5;
  Board.score++;
  [Board.score, Board.title] = [Board.score + 1, "outside"];
  return [state(), Board.shorthand()];
});
show("keys", () => Object.keys(Board).slice(0, 4));
show("did globals appear", () => ["score" in globalThis, "title" in globalThis]);

let sum = 0;
for (let i = 0; i < 2000; i++) {
  Board.assign(i);
  Board.raise();
  sum += Board.score;
}
show("2000 rounds", () => sum);

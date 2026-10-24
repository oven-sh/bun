function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

type Scores = Record<string, number>;

function put(scores: Scores, key: string, value: number): number {
  scores[key] = value;
  return scores[key];
}

function add(scores: Scores, key: string): number {
  scores[key] = (scores[key] ?? 0) + 1;
  return scores[key];
}

function drop(scores: Scores, key: string): boolean {
  return delete scores[key];
}

function tally(scores: Scores, words: string[]): string {
  for (const word of words) add(scores, word);
  return JSON.stringify(scores);
}

const makers: [string, () => Scores][] = [
  ["open", () => ({ a: 1 })],
  ["not extensible", () => Object.preventExtensions<Scores>({ a: 1 })],
  ["sealed", () => Object.seal<Scores>({ a: 1 })],
  ["frozen", () => Object.freeze<Scores>({ a: 1 })],
  ["no prototype, sealed", () => Object.seal<Scores>(Object.assign(Object.create(null), { a: 1 }))],
];

for (const [label, make] of makers) {
  const uses: [string, (s: Scores) => unknown][] = [
    ["a key it has", s => put(s, "a", 2)],
    ["a new key", s => put(s, "b", 2)],
    ["a new index key", s => put(s, "0", 2)],
    ["counting a key it has", s => add(s, "a")],
    ["counting a new key", s => add(s, "b")],
    ["deleting a key it has", s => drop(s, "a")],
    ["deleting a key it lacks", s => drop(s, "b")],
    ["a named store", s => (s.a = 3)],
    ["a named store of a new key", s => (s.c = 3)],
    ["tallying", s => tally(s, ["a", "a", "b"])],
  ];
  for (const [name, use] of uses) {
    const s = make();
    attempt(label + ", " + name, () => use(s));
    console.log("  holds " + JSON.stringify(s));
  }
}

const open: Scores = {};
for (let i = 0; i < 2000; i++) put(open, "k" + (i % 50), i);
console.log("2000 honest stores: " + Object.keys(open).length);
attempt("then a sealed record, a new key", () => put(Object.seal<Scores>({}), "k1", 1));
attempt("then a frozen record, a key it has", () => put(Object.freeze<Scores>({ k1: 0 }), "k1", 1));
attempt("then the open one", () => put(open, "new", 1));

const closing: Scores = {};
attempt("closed in the middle of a loop", () => {
  for (let i = 0; i < 2000; i++) {
    closing["k" + i] = i;
    if (i === 99) Object.preventExtensions(closing);
  }
  return "finished";
});
console.log("it holds " + Object.keys(closing).length + " keys");

class Board {
  scores: Scores = Object.seal<Scores>({ home: 0, away: 0 });
  goal(team: string): number {
    return ++this.scores[team];
  }
}
const board = new Board();
attempt("a field, a key it has", () => board.goal("home"));
attempt("a field, a new key", () => board.goal("guest"));
console.log("the board: " + JSON.stringify(board));

const list: Scores[] = [{}, Object.preventExtensions<Scores>({}), {}];
attempt("elements", () => list.map(s => put(s, "x", 1)).join());
console.log("the list: " + JSON.stringify(list));

export {};

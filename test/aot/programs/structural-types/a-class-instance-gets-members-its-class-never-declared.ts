class Card {
  rank = 5;
  suit = "hearts";
  text(): string {
    return this.rank + " of " + this.suit;
  }
}

interface Marked extends Card {
  mark?: string;
  weight?: number;
}

function listing(o: object): string {
  const walked: string[] = [];
  for (const key in o) walked.push(key);
  return Object.keys(o).join() + " | " + walked.join() + " | " + JSON.stringify(o) + " | " + JSON.stringify({ ...o });
}

function text(c: Card): string {
  return c.text() + " " + c.rank + " " + c.suit;
}

const warm = new Card();
let length = 0;
for (let i = 0; i < 2000; i++) length += text(warm).length + Object.keys(warm).length;
console.log("2000 untouched: " + length);

const marked: Marked = new Card();
marked.mark = "bent";
console.log("one extra: " + text(marked) + " / " + listing(marked));
marked.weight = 1.5;
console.log("two extras: " + text(marked) + " / " + listing(marked));
delete marked.mark;
console.log("the first extra deleted: " + text(marked) + " / " + listing(marked));
marked.mark = "again";
console.log("and added again: " + text(marked) + " / " + listing(marked));
console.log("still an instance: " + (marked instanceof Card) + " " + marked.constructor.name);

const stuffed = new Card();
const extras: Record<string, number> = {};
for (let i = 0; i < 100; i++) extras["extra" + i] = i;
Object.assign(stuffed, extras);
console.log("a hundred extras: " + text(stuffed) + " " + Object.keys(stuffed).length + " " + Object.keys(stuffed).slice(0, 4).join() + " " + JSON.stringify(stuffed).length);
stuffed.rank = 6;
stuffed.suit = "spades";
console.log("its declared fields stored: " + text(stuffed) + " " + Object.keys(stuffed).slice(0, 3).join());
for (let i = 0; i < 100; i++) Reflect.deleteProperty(stuffed, "extra" + i);
console.log("the extras deleted: " + text(stuffed) + " / " + listing(stuffed));

const indexed = Object.assign(new Card(), { 1: "one", 0: "zero" });
console.log("index keys come first: " + text(indexed) + " / " + listing(indexed));

const tag = Symbol("tag");
const tagged = Object.assign(new Card(), { [tag]: true });
console.log("a symbol key: " + text(tagged) + " / " + listing(tagged) + " " + Object.getOwnPropertySymbols(tagged).length);

const loose: { rank?: number; suit?: string } = new Card();
const strict: Card = Object.assign(new Card(), {});
const looseView: { rank?: number; suit?: string } = strict;
delete looseView.rank;
console.log("a declared field deleted: " + listing(strict) + " " + ("rank" in strict) + " " + typeof strict.rank + " " + strict.text());
looseView.rank = 9;
console.log("and stored again, now last: " + listing(strict) + " " + strict.text());
delete loose.suit;
delete loose.rank;
console.log("both deleted: " + listing(loose));
loose.suit = "clubs";
loose.rank = 2;
console.log("stored in the other order: " + listing(loose));

const watched = new Card();
const reads: string[] = [];
Object.defineProperty(watched, "rank", {
  get() {
    reads.push("get rank");
    return 12;
  },
  set(value: number) {
    reads.push("set rank " + value);
  },
  enumerable: true,
  configurable: true,
});
console.log("a declared field turned into an accessor: " + text(watched) + " [" + reads.join() + "]");
watched.rank = 3;
console.log("stored: " + watched.rank + " [" + reads.join() + "] / " + listing(watched));

const hidden = new Card();
Object.defineProperty(hidden, "suit", { enumerable: false });
console.log("a declared field hidden: " + text(hidden) + " / " + listing(hidden));

const all: Card[] = [warm, marked, stuffed, indexed, tagged, strict, watched, hidden];
console.log("all: " + all.map(c => c.text()).join("; "));
console.log("untouched at the end: " + text(new Card()) + " / " + listing(new Card()));

export {};

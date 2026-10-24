type Inner = { n: number };
type Message = { id: number; inner: Inner; tags: string[]; title: string; done: boolean; note?: string };
const makeInner = (n: number): Inner => ({ n });
const makeMessage = (id: number, inner: Inner, tags: string[]): Message => ({ id, inner, tags, title: "typed", done: false, note: "n" });
const grow = (id: unknown, inner: unknown, tags: unknown, title: unknown, done: unknown, note: unknown): any => {
  const message: any = { id };
  message.inner = inner;
  message.tags = tags;
  message.title = title;
  message.done = done;
  message.note = note;
  return message;
};
const growInAnotherOrder = (id: unknown, inner: unknown, tags: unknown): any => {
  const message: any = { note: "last first" };
  message.done = true;
  message.title = "other order";
  message.tags = tags;
  message.inner = inner;
  message.id = id;
  return message;
};
const read = (message: Message) => message.id + message.inner.n + message.tags.length + message.title.length + (message.done ? 1 : 0) + (message.note === undefined ? 100 : message.note.length);
const inner = makeInner(7);
const tags = ["x", "y"];
const kept: unknown[] = [];
const attempt = (label: string, make: () => any) => {
  for (let i = 0; i < 4; i++) {
    try {
      const message = make();
      kept.push(message);
      console.log(label, i, read(message));
    } catch (error) {
      console.log(label, i, error instanceof TypeError ? "TypeError" : String(error));
    }
  }
};

console.log(read(makeMessage(1, inner, tags)));
attempt("fits", () => grow(1, inner, tags, "grown", true, "note"));
attempt("a fraction", () => grow(1.5, inner, tags, "grown", false, "note"));
attempt("another order", () => growInAnotherOrder(2, inner, tags));
attempt("note undefined", () => grow(1, inner, tags, "grown", true, undefined));
attempt("id is a string", () => grow("one", inner, tags, "grown", true, "note"));
attempt("inner is a number", () => grow(1, 5, tags, "grown", true, "note"));
attempt("inner is plain", () => grow(1, { n: 9 }, tags, "grown", true, "note"));
attempt("inner is plain and wrong", () => grow(1, { n: "nine" }, tags, "grown", true, "note"));
attempt("tags is a string", () => grow(1, inner, "xy", "grown", true, "note"));
attempt("title is a number", () => grow(1, inner, tags, 5, true, "note"));
attempt("done is a number", () => grow(1, inner, tags, "grown", 1, "note"));
attempt("note is a number, which nothing reads as one", () => grow(1, inner, tags, "grown", true, 5));
attempt("fits again", () => grow(3, inner, tags, "grown", true, "note"));

let turn = 0;
attempt("fits and does not, in turn", () => grow(turn++ & 1 ? "odd" : 4, inner, tags, "grown", true, "note"));

const same = grow(5, inner, tags, "same", false, "note");
for (let i = 0; i < 4; i++) {
  console.log("the same object", i, read(same));
  same.id++;
}
console.log(Object.keys(same).join(), JSON.stringify(same));

const withGetter = grow(6, inner, tags, "getter", true, "note");
let asked = 0;
Object.defineProperty(withGetter, "id", { get() { asked++; return 6; }, enumerable: true, configurable: true });
for (let i = 0; i < 3; i++) console.log("a getter", i, read(withGetter), asked);

const frozen = Object.freeze(grow(7, inner, tags, "frozen", true, "note"));
for (let i = 0; i < 3; i++) console.log("frozen", i, read(frozen), Object.isFrozen(frozen));

const inherits = Object.create(grow(8, inner, tags, "inherited", true, "note"));
for (let i = 0; i < 3; i++) console.log("inherits everything", i, read(inherits), Object.keys(inherits).length);

const surplus = () => {
  const message = grow(9, inner, tags, "surplus", true, "note");
  message.more = "more";
  return message;
};
attempt("one key more", surplus);
const last = surplus();
console.log(read(last), last.more, Object.keys(last).join());

const lacking = (): any => {
  const message: any = { id: 10 };
  message.inner = inner;
  message.tags = tags;
  message.title = "lacks note";
  message.done = true;
  return message;
};
attempt("lacks the optional key", lacking);
const holder = { note: "from the prototype" };
attempt("lacks the optional key, which its prototype has", () => Object.assign(Object.create(holder), lacking()));
attempt("lacks the optional key again", lacking);

let old: any[] = [];
for (let i = 0; i < 20; i++) old.push(grow(i, inner, tags, "old", true, "note"));
let garbage: unknown[] = [];
for (let i = 0; i < 200000; i++) garbage = [garbage.length, i];
let sum = 0;
for (let round = 0; round < 3; round++) for (const message of old) sum += read(message);
console.log(sum, kept.length, garbage.length);
for (const message of kept as any[]) sum += typeof message.id === "number" ? message.id : 0;
console.log(sum);

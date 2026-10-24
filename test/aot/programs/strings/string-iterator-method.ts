// text[Symbol.iterator]() returns an iterator over the code points of a string: in for..of, stepped by hand, spread, destructured, half used, passed on, and borrowed by a receiver that is no string.
export {};

const lines: string[] = [];
function units(text: string): string {
  let said = "";
  for (let i = 0; i < text.length; i++) said += (i ? "." : "") + text.charCodeAt(i).toString(16);
  return said;
}
function show(value: unknown): string {
  if (typeof value === "string") return "<" + units(value) + ">";
  if (Array.isArray(value)) return "[" + value.map(element => show(element)).join(",") + "]";
  return String(value);
}
function attempt(name: string, run: () => unknown): void {
  let said: string;
  try {
    said = show(run());
  } catch (error) {
    said = error instanceof TypeError ? "TypeError" : "another error";
  }
  lines.push(name + ": " + said);
}

function pointsOf(text: string): string[] {
  const points: string[] = [];
  for (const point of text[Symbol.iterator]()) points.push(point);
  return points;
}
function countPoints(text: string): number {
  let count = 0;
  const iterator = text[Symbol.iterator]();
  while (!iterator.next().done) count++;
  return count;
}
function step(iterator: Iterator<unknown>, times: number): unknown[] {
  const seen: unknown[] = [];
  for (let i = 0; i < times; i++) {
    const result = iterator.next();
    seen.push(result.done, result.value);
  }
  return seen;
}
function concatenate(left: string, right: string): string {
  return left + right;
}
function iterate(receiver: unknown): unknown[] {
  return [...(String.prototype[Symbol.iterator].call(receiver) as Iterable<unknown>)];
}

const texts = ["", "a", "abc", "café", "日本", "\u{1f600}", "a\u{1f600}b", "\ud83d", "\ude00", "\ude00\ud83d", "x\ud83d", concatenate("\ud83d", "\ude00"), concatenate("ab", "\u{1f680}c"), "xx日\u{1f600}xx".slice(2, 5), "xx日\u{1f600}xx".slice(2, 4)];
for (const text of texts) attempt("points of " + show(text), () => [pointsOf(text), countPoints(text), pointsOf(text).join("") === text]);
attempt("a long rope", () => {
  let text = "";
  for (let i = 0; i < 300; i++) text += i % 7 ? "a" : "\u{1f600}";
  return [countPoints(text), text.length, pointsOf(text)[294]];
});

attempt("stepped past the end", () => step("a\u{1f600}"[Symbol.iterator](), 4));
attempt("no characters, stepped", () => step(""[Symbol.iterator](), 2));
attempt("spread", () => [..."a\u{1f600}b"[Symbol.iterator]()]);
attempt("destructured", () => {
  const [first, second = "default", ...rest] = "\u{1f600}bcd"[Symbol.iterator]();
  const [only, missing = "default"] = "x"[Symbol.iterator]();
  return [first, second, rest, only, missing];
});
attempt("half used", () => {
  const iterator = "abcd"[Symbol.iterator]();
  iterator.next();
  iterator.next();
  return [[...iterator], [...iterator]];
});
attempt("left early", () => {
  const iterator = "abcd"[Symbol.iterator]();
  for (const point of iterator) if (point === "b") break;
  return [...iterator];
});
attempt("an iterator is its own iterable", () => {
  const iterator = "ab"[Symbol.iterator]();
  return iterator[Symbol.iterator]() === iterator;
});
attempt("two iterators over one string", () => {
  const text = concatenate("a", "b");
  const first = text[Symbol.iterator]();
  const second = text[Symbol.iterator]();
  return [first === second, first.next().value, first.next().value, second.next().value];
});
attempt("passed on", () => [Array.from("a\u{1f600}"[Symbol.iterator]()), new Set("abca"[Symbol.iterator]()).size, Array.from("ab"[Symbol.iterator](), point => point + point)]);
attempt("the kind of object", () => {
  const iterator = "a"[Symbol.iterator]();
  return [typeof iterator.next, Object.prototype.toString.call(iterator), Object.keys(iterator).length, Object.getPrototypeOf(iterator) === Object.getPrototypeOf(""[Symbol.iterator]())];
});

attempt("borrowed by a String object", () => iterate(new String("a\u{1f600}")));
attempt("borrowed by a number", () => iterate(-1.5));
attempt("borrowed by an array", () => iterate([1, [2, 3]]));
attempt("borrowed by an object", () => {
  const receiver = {
    toString(): string {
      lines.push("toString was called");
      return "ok";
    },
  };
  return iterate(receiver);
});
attempt("borrowed by undefined", () => iterate(undefined));
attempt("borrowed by null", () => iterate(null));
attempt("borrowed by a symbol", () => iterate(Symbol.iterator));

console.log(lines.join("\n"));

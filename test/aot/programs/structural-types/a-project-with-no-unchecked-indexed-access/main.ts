function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

function firstPlusOne(list: number[]): number {
  const first = list[0];
  return first === undefined ? -1 : first + 1;
}

function checkedInPlace(list: number[]): number {
  if (list[0] !== undefined) return list[0] + 1;
  return -1;
}

function checkedThenChanged(list: number[], change: () => void): number {
  if (list[0] !== undefined) {
    change();
    return list[0] + 1;
  }
  return -1;
}

function total(list: number[]): number {
  let sum = 0;
  for (const n of list) sum += n;
  return sum;
}

function totalByIndex(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i] ?? 1000;
  return sum;
}

function score(scores: Record<string, number>, name: string): number {
  const s = scores[name];
  return s === undefined ? -1 : s + 1;
}

function scoreInPlace(scores: Record<string, number>): number {
  return scores.a !== undefined ? scores.a + 1 : -1;
}

function letter(text: string, index: number): string {
  const c = text[index];
  return c === undefined ? "none" : c.toUpperCase();
}

function pair(t: [number, number]): number {
  return t[0] + t[1];
}

function unpacked(list: number[]): string {
  const [a, b] = list;
  return typeof a + ":" + typeof b;
}

function rest(list: number[]): number {
  const [, ...others] = list;
  return total(others);
}

attempt("honest", () => [firstPlusOne([1]), firstPlusOne([]), checkedInPlace([1]), checkedThenChanged([1], () => {}), total([1, 2]), totalByIndex([1, 2]), score({ a: 1 }, "a"), score({ a: 1 }, "b"), scoreInPlace({ a: 1 }), letter("ab", 1), letter("ab", 5), pair([1, 2]), unpacked([1]), rest([1, 2, 3])]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += firstPlusOne([i]) + checkedInPlace([i]) + total([i, 1]) + totalByIndex([i, 1]) + score({ a: i }, "a") + pair([i, 1]);
console.log("2000 honest rounds", warm);

attempt("holes: for-of hands out undefined as a number", () => total(new Array<number>(2)));
attempt("holes: by index", () => totalByIndex(new Array<number>(2)));
attempt("holes: in the middle", () => {
  const list = [1, 2, 3];
  delete list[1];
  return [total(list), totalByIndex(list), list.map(n => n + 1), list.reduce((a, b) => a + b, 0)];
});
attempt("holes: forEach, some and find see different things", () => {
  const list = new Array<number>(2);
  list[1] = 5;
  let visited = 0;
  list.forEach(() => visited++);
  const found: number | undefined = list.find(() => true);
  return [visited, found, list.findIndex(n => n === undefined), list.includes(5), list.indexOf(5)];
});
attempt("made longer", () => {
  const list = [1];
  list.length = 3;
  return [total(list), totalByIndex(list), unpacked(list)];
});
attempt("emptied between the test and the read", () => {
  const list = [1];
  return checkedThenChanged(list, () => {
    list.length = 0;
  });
});
attempt("an element that is a getter", () => {
  const list = [1];
  let reads = 0;
  Object.defineProperty(list, 0, { get: () => (reads++ === 0 ? 1 : undefined), configurable: true });
  return checkedInPlace(list);
});
attempt("a tuple that was popped", () => {
  const t: [number, number] = [1, 2];
  t.pop();
  return pair(t);
});
attempt("names that every object has", () => [score({}, "constructor"), score({}, "toString"), score({}, "__proto__"), score({}, "hasOwnProperty")]);
attempt("a name removed between the test and the read", () => {
  const scores: Record<string, number> = { a: 1 };
  const drop = () => {
    delete scores.a;
  };
  if (scores.a !== undefined) {
    drop();
    return scores.a + 1;
  }
  return -1;
});
attempt("odd indexes", () => [firstPlusOne([]), letter("ab", -1), letter("ab", 0.5), letter("ab", NaN), [1, 2][-1], [1, 2][1.5], [1, 2][Infinity]]);
attempt("spread and Math.max over holes", () => [Math.max(...new Array<number>(2)), [...new Array<number>(2)].length]);
attempt("an iterator result", () => {
  const it = [1][Symbol.iterator]();
  it.next();
  const r = it.next();
  return [r.done, r.value];
});
attempt("honest again", () => [firstPlusOne([1]), checkedInPlace([1]), total([1, 2]), totalByIndex([1, 2]), score({ a: 1 }, "a"), pair([1, 2])]);

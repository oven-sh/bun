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

interface Source {
  note: string;
}
class Source {
  own: number = 1;
}

class Page {
  title: string = "title";
  constructor(public author: string = "nobody") {}
  heading(): string {
    return this.title + "!";
  }
  width(): number {
    return this.title.length;
  }
}

function same(s: string): string {
  return s;
}

function joined(a: string, b: string): string {
  return a + b;
}

function width(s: string): number {
  return s.length;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const page = new Page("a" + (i % 3));
  page.title = "t" + (i % 5);
  warm += same("ab").length + joined("a", "bc").length + width("abcd") + page.heading().length + page.width() + page.author.length;
}
show("2000 honest rounds", () => warm);

const source = new Source();

show("a local", () => {
  let s: string = "before";
  s = source.note;
  return s;
});
show("a parameter and a result", () => [same(source.note), joined(source.note, "b"), joined("a", source.note)]);
show("its length in a typed function", () => width(source.note));
show("a field", () => {
  const page = new Page();
  page.title = source.note;
  return [page.title, typeof page.title, page.heading(), JSON.stringify(page), Object.keys(page)];
});
show("the length of the field", () => {
  const page = new Page();
  page.title = source.note;
  return page.width();
});
show("a parameter property takes its default", () => new Page(source.note).author);
show("an element", () => {
  const list: string[] = ["a", "b", "c"];
  list[1] = source.note;
  return [list, list.join("-"), 1 in list];
});
show("the length of an element", () => {
  const list: string[] = [source.note];
  return list[0].length;
});
show("sorted among strings", () => ["b", source.note, "a"].sort());
show("a captured variable", () => {
  const held: string = source.note;
  const read = (): string => held;
  const tail = (): string => held + "!";
  return [read(), tail()];
});
show("added to in a loop", () => {
  let all = "";
  for (let i = 0; i < 2; i++) all += source.note;
  return all;
});
show("a key of a record", () => {
  const record: Record<string, number> = {};
  record[source.note] = 1;
  return Object.keys(record);
});
show("a key of a map", () => {
  const map = new Map<string, number>([[source.note, 1]]);
  return [map.has("undefined"), map.has(source.note), [...map.keys()]];
});
show("a literal", () => {
  const card: { front: string; back: string } = { front: source.note, back: "b" };
  return [card.front, card.front + card.back, JSON.stringify(card)];
});
show("as an argument of string methods", () => ["undefined".indexOf(source.note), "a-undefined".split(source.note), "x".concat(source.note), "x".padEnd(3, source.note), "abc".startsWith(source.note)]);
show("as an argument of other built-ins", () => [parseInt(source.note), Number(source.note), JSON.stringify(source.note), encodeURIComponent(source.note)]);
show("JSON.parse of it", () => JSON.parse(source.note));
show("new RegExp of it", () => new RegExp(source.note).source);
show("compared", () => [source.note === "undefined", source.note == "undefined", source.note < "z", source.note > "a"]);

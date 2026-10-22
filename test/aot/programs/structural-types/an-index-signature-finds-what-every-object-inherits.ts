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

interface Counts {
  [word: string]: number;
}

function countOf(counts: Counts, word: string): number {
  return counts[word];
}

function bump(counts: Counts, word: string): void {
  counts[word] = (counts[word] ?? 0) + 1;
}

function bumpIfSeen(counts: Counts, word: string): void {
  if (counts[word]) counts[word]++;
  else counts[word] = 1;
}

const inherited = ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf", "__defineGetter__"];

const counts: Counts = { the: 2 };
for (const word of inherited) {
  show(word + ": typeof", () => typeof countOf(counts, word));
  show(word + ": typeof it plus one", () => typeof (countOf(counts, word) + 1));
  show(word + ": is it a number above zero", () => countOf(counts, word) > 0);
  show(word + ": in", () => word in counts);
  show(word + ": own", () => Object.hasOwn(counts, word));
}

const tallied: Counts = {};
for (const word of ["the", "constructor", "the", "toString", "constructor"]) bump(tallied, word);
show("words counted with ??: keys", () => Object.keys(tallied));
show("words counted with ??: the", () => tallied.the);
show("words counted with ??: typeof constructor", () => typeof countOf(tallied, "constructor"));
show("words counted with ??: does it end in 11", () => String(countOf(tallied, "constructor")).endsWith("11"));

const seen: Counts = {};
for (const word of ["the", "valueOf", "the", "valueOf"]) bumpIfSeen(seen, word);
show("words counted with an if: keys", () => Object.keys(seen));
show("words counted with an if", () => [seen.the, countOf(seen, "valueOf")]);

const bare: Counts = Object.create(null);
for (const word of ["the", "constructor", "the", "__proto__", "constructor"]) bump(bare, word);
show("without a prototype: keys", () => Object.keys(bare));
show("without a prototype", () => [bare.the, countOf(bare, "constructor"), countOf(bare, "__proto__"), countOf(bare, "toString")]);

const proto: Counts = {};
show("a number stored under __proto__ is dropped", () => {
  proto["__proto__"] = 5;
  return [typeof countOf(proto, "__proto__"), Object.keys(proto)];
});

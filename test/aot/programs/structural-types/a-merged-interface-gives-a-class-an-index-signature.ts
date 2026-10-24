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

interface Scores {
  [player: string]: number;
}
class Scores {
  base: number = 10;
}

interface Slots {
  [index: number]: string;
  length: number;
}
class Slots {
  id: number = 1;
}

function scoreOf(scores: Scores, player: string): number {
  return scores[player];
}

function raised(scores: Scores, player: string): number {
  return scores[player] + 1;
}

const scores = new Scores();
show("a member that is made", () => [scores.base, scoreOf(scores, "base"), raised(scores, "base")]);
show("by a name nobody stored", () => scores.ann);
show("typeof", () => typeof scores.ann);
show("plus one", () => scores.ann + 1);
show("toFixed", () => scores.ann.toFixed(1));
show("by a computed name", () => scoreOf(scores, "bob"));
show("by a computed name, plus one", () => raised(scores, "bob"));
show("a name that Object.prototype has", () => typeof scoreOf(scores, "toString"));
show("that one plus one is text", () => typeof raised(scores, "valueOf"));
show("the constructor", () => Object.is(scoreOf(scores, "constructor"), Scores));
show("__proto__", () => typeof scoreOf(scores, "__proto__"));
show("the empty name", () => scoreOf(scores, ""));
show("keys", () => Object.keys(scores));

scores.ann = 5;
scores["bob"] = 6.5;
show("after stores", () => [scores.ann, scoreOf(scores, "bob"), raised(scores, "ann"), Object.keys(scores)]);
scores.cid++;
show("++ where there is nothing", () => [scores.cid, Object.keys(scores)]);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += scoreOf(scores, i % 2 === 0 ? "ann" : "bob");
show("2000 reads of names that are there", () => sum);
show("one that is not", () => [scoreOf(scores, "dee"), raised(scores, "dee")]);
show("added up over names", () => ["ann", "dee", "bob"].reduce((total, name) => total + scoreOf(scores, name), 0));

const slots = new Slots();
show("slots: an index nobody stored", () => slots[0]);
show("slots: its length", () => slots[0].length);
show("slots: length", () => [slots.length, slots.length + 1]);
show("slots: as an array-like", () => Array.from(slots));
slots[1] = "one";
slots.length = 2;
show("slots: after stores", () => [slots[0], slots[1], Array.from(slots), Object.keys(slots)]);

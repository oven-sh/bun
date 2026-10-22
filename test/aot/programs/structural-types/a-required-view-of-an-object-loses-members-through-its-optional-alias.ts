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

interface Options {
  depth?: number;
  title?: string;
  tags?: string[];
  onDone?: () => number;
}

type Full = Required<Options>;

function depthPlusOne(full: Full): number {
  return full.depth + 1;
}

function titleLength(full: Full): number {
  return full.title.length;
}

function tagCount(full: Full): number {
  return full.tags.length;
}

function finish(full: Full): number {
  return full.onDone();
}

function fresh(): Full {
  return { depth: 1, title: "full", tags: ["t"], onDone: () => 9 };
}

function all(label: string, full: Full): void {
  show(label + ": the number", () => [full.depth, depthPlusOne(full)]);
  show(label + ": the text", () => full.title);
  show(label + ": the length of the text", () => titleLength(full));
  show(label + ": the list", () => tagCount(full));
  show(label + ": the function", () => finish(full));
  show(label + ": keys", () => Object.keys(full));
  show(label + ": JSON", () => JSON.stringify(full));
}

class Job {
  options: Full = fresh();
  run(): number {
    return this.options.depth + this.options.title.length + this.options.onDone();
  }
}

let sum = 0;
for (let i = 0; i < 2000; i++) {
  const full = fresh();
  sum += depthPlusOne(full) + titleLength(full) + tagCount(full) + finish(full);
}
show("2000 honest rounds", () => sum);
all("untouched", fresh());

const deleted = fresh();
const looseDeleted: Options = deleted;
delete looseDeleted.depth;
delete looseDeleted.title;
delete looseDeleted.tags;
delete looseDeleted.onDone;
all("deleted through the alias", deleted);

const blanked = fresh();
const looseBlanked: Options = blanked;
looseBlanked.depth = undefined;
looseBlanked.title = undefined;
looseBlanked.tags = undefined;
looseBlanked.onDone = undefined;
all("undefined stored through the alias", blanked);

const partial: Options = { depth: undefined, title: "given" };
const merged: Full = { ...fresh(), ...partial };
all("an optional object spread over a full one", merged);

const assigned: Full = Object.assign(fresh(), partial);
all("an optional object assigned over a full one", assigned);

const job = new Job();
show("in a field: before", () => job.run());
const looseField: Options = job.options;
delete looseField.depth;
show("in a field: the number deleted", () => job.run());
delete looseField.onDone;
show("in a field: the function deleted", () => job.run());

const queue: Full[] = [fresh(), fresh(), fresh()];
const looseQueue: Options[] = queue;
looseQueue[1] = {};
show("in a list: an empty object stored through the alias of the list", () => queue.map(full => full.depth));
show("in a list: added up", () => queue.reduce((total, full) => total + full.depth, 0));
show("in a list: the length of each text", () => queue.map(titleLength));

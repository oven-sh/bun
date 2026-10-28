// A literal of a type with many optional members sets a few of them. The others start as "absent", which is zero bits for references, values, booleans and plain numbers: they are filled sixteen bytes at a time, not field by field.
// SIZE< few 80
// SIZE< mixed 128
interface Options {
  name: string;
  title?: string;
  owner?: Options;
  tags?: string[];
  note?: string;
  parent?: Options;
  hidden?: boolean;
  pinned?: boolean;
  weight?: number;
  count?: number;
  extra?: unknown;
  more?: unknown;
  last?: string;
}

function few(name: string): Options { return { name }; }
function mixed(name: string, parent: Options, count: number): Options { return { name, parent, hidden: true, count, last: name }; }
function none(name: string, other: Options, list: string[]): Options {
  return { name, title: name, owner: other, tags: list, note: name, parent: other, hidden: false, pinned: true, weight: 1.5, count: 2, extra: null, more: 0, last: name };
}

function describe(label: string, options: Options): void {
  const seen: string[] = [];
  seen.push(String(options.name), String(options.title), String(options.owner?.name), String(options.tags), String(options.note), String(options.parent?.name));
  seen.push(String(options.hidden), String(options.pinned), String(options.weight), String(options.count), String(options.extra), String(options.more), String(options.last));
  const has: string[] = [];
  for (const key of ["name", "title", "owner", "tags", "note", "parent", "hidden", "pinned", "weight", "count", "extra", "more", "last"]) if (key in options) has.push(key);
  console.log(label + ": " + seen.join() + " | " + has.join() + " | " + Object.keys(options).join() + " | " + JSON.stringify(options));
}

const fewMakers: ((name: string) => Options)[] = [few];
const mixedMakers: ((name: string, parent: Options, count: number) => Options)[] = [mixed];
const noneMakers: ((name: string, other: Options, list: string[]) => Options)[] = [none];
const first = fewMakers[0]!("a");
describe("few", first);
describe("mixed", mixedMakers[0]!("b", first, 3));
describe("none", noneMakers[0]!("c", first, ["x"]));

const held: Options[] = [];
for (let i = 0; i < 3000; i++) {
  const made = i % 3 === 0 ? fewMakers[0]!("n" + i) : i % 3 === 1 ? mixedMakers[0]!("n" + i, held[i - 1]!, i) : noneMakers[0]!("n" + i, held[i - 1]!, ["t" + i]);
  held.push(made);
}
let set = 0;
let absent = 0;
for (const options of held) {
  for (const value of [options.title, options.owner, options.tags, options.note, options.parent, options.hidden, options.pinned, options.weight, options.count, options.extra, options.more, options.last]) {
    if (value === undefined) absent++;
    else set++;
  }
}
console.log(set, absent);
first.weight = 2.5;
first.pinned = false;
first.last = "z";
first.owner = held[1];
describe("few, filled later", first);

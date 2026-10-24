// Plain objects that were frozen, sealed or made non-extensible enter typed code again and again: each time they read, refuse and accept what they do in plain JavaScript, the first time and every later time.
type Reading = { id: number; unit: string; note?: string };
type Holder = { name: string; reading: Reading };
type Choice = { kind: "left"; x: number } | { kind: "right"; y: string };

const levels: [string, (value: any) => any][] = [
  ["open", value => value],
  ["not extensible", value => Object.preventExtensions(value)],
  ["sealed", value => Object.seal(value)],
  ["frozen", value => Object.freeze(value)],
];
function attempt(f: () => unknown): string {
  try {
    return String(f());
  } catch (error) {
    return (error as Error).name;
  }
}
function state(value: object): string {
  return (Object.isFrozen(value) ? "F" : "-") + (Object.isSealed(value) ? "S" : "-") + (Object.isExtensible(value) ? "E" : "-");
}
function use(reading: Reading): string {
  return [
    state(reading),
    reading.id + reading.unit,
    attempt(() => (reading.id += 10)),
    attempt(() => (reading.note = "n")),
    attempt(() => delete reading.note),
    reading.id,
    Object.keys(reading).join(),
  ].join(" ");
}
function useHolder(holder: Holder): string {
  return [state(holder), state(holder.reading), attempt(() => (holder.name += "!")), attempt(() => ++holder.reading.id), holder.name, holder.reading.id].join(" ");
}
function useChoice(choice: Choice): string {
  return state(choice) + " " + (choice.kind === "left" ? attempt(() => ++choice.x) : attempt(() => (choice.y += "y")));
}
const grow = (id: number): any => {
  const reading: any = { id };
  reading.unit = "mm";
  return reading;
};

for (const [name, level] of levels) {
  console.log(name);
  for (let turn = 0; turn < 4; turn++) {
    const reading = level(grow(turn));
    console.log("  reading", use(reading), "| outside", reading.id, reading.note, state(reading));
  }
  for (let turn = 0; turn < 4; turn++) {
    const reading = grow(turn);
    reading.note = "had";
    console.log("  with the optional key", use(level(reading)), "| outside", reading.id, reading.note);
  }
  for (let turn = 0; turn < 4; turn++) {
    const reading = grow(turn);
    reading.extra = turn;
    console.log("  with a key of its own", use(level(reading)), "| outside", reading.id, reading.extra);
  }
  for (let turn = 0; turn < 4; turn++) {
    const holder: any = level({ name: "h" + turn, reading: turn % 2 ? level(grow(turn)) : grow(turn) });
    console.log("  holder", useHolder(holder), "| outside", holder.name, holder.reading.id);
  }
  for (let turn = 0; turn < 6; turn++) {
    const choice: any = level(turn % 2 ? { kind: "left", x: turn } : { kind: "right", y: "t" + turn });
    console.log("  choice", useChoice(choice), "| outside", choice.x, choice.y);
  }
  for (let turn = 0; turn < 4; turn++) {
    const reading = grow(turn);
    Object.defineProperty(reading, "unit", { writable: false });
    console.log("  one read-only key", use(level(reading)), attempt(() => ((reading as Reading).unit = "cm")));
  }
  const same = level(grow(100));
  console.log("  the same object twice", use(same), "|", use(same), "| outside", same.id);
}

let total = 0;
let refused = 0;
function bump(reading: Reading): number {
  try {
    reading.id++;
  } catch {
    refused++;
  }
  return reading.id;
}
for (let i = 0; i < 40000; i++) total += bump(levels[i & 3][1](grow(i)));
console.log(total, refused);

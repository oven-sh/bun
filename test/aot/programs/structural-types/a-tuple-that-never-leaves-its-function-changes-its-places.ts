function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

type Entry = [number, string];

function reversed(): string {
  const entry: Entry = [1, "a"];
  entry.reverse();
  const [count, name] = entry;
  return typeof count + " " + typeof name + " " + show(count + 1) + " " + show(name + "!") + " " + show(entry[0]) + " " + show(entry[1]) + " " + entry.length;
}

function popped(): string {
  const entry: Entry = [1, "a"];
  entry.pop();
  const [count, name] = entry;
  return typeof count + " " + typeof name + " " + show(name + "!") + " " + entry.length + " " + (entry.length === 2) + " " + show(entry);
}

function poppedThenAMethod(): string {
  const entry: Entry = [1, "a"];
  entry.pop();
  try {
    return entry[1].toUpperCase();
  } catch (error) {
    return "threw " + (error instanceof TypeError);
  }
}

function shifted(): string {
  const entry: Entry = [1, "a"];
  entry.shift();
  return typeof entry[0] + " " + typeof entry[1] + " " + show(entry[0] + 1) + " " + show(entry[0] * 2) + " " + entry.length;
}

function pushed(): string {
  const entry: Entry = [1, "a"];
  entry.push(2, "b");
  let count = 0;
  for (const member of entry) count += typeof member === "number" ? member : member.length;
  return entry.length + " " + (entry.length === 2) + " " + count + " " + show([...entry]) + " " + show(entry);
}

function filled(): string {
  const entry: Entry = [1, "a"];
  entry.fill("x");
  return typeof entry[0] + " " + show(entry[0] + 1) + " " + show(entry[0] * 2) + " " + show(entry);
}

function sorted(): string {
  const entry: Entry = [10, "1"];
  entry.sort();
  return typeof entry[0] + " " + typeof entry[1] + " " + show(entry[0] + 1) + " " + show(entry);
}

function spliced(): string {
  const entry: Entry = [1, "a"];
  entry.splice(0, 1);
  return typeof entry[0] + " " + typeof entry[1] + " " + show(entry[0] + 1) + " " + entry.length;
}

function emptied(): string {
  const entry: Entry = [1, "a"];
  const alias: (number | string)[] = entry;
  alias.length = 0;
  return typeof entry[0] + " " + typeof entry[1] + " " + show(entry[0] + 1) + " " + entry.length + " " + show(entry);
}

function copiedWithin(): string {
  const entry: Entry = [1, "a"];
  entry.copyWithin(0, 1);
  return typeof entry[0] + " " + show(entry[0] + 1) + " " + show(entry);
}

function readBeforeAndAfter(): string {
  const entry: Entry = [1, "a"];
  const before = entry[0] + 1;
  entry.reverse();
  const after = entry[0] + 1;
  return show(before) + " " + show(after);
}

function twoNumbers(): string {
  const pair: [number, number] = [1, 0.5];
  pair.reverse();
  pair.push(7);
  pair.shift();
  return show(pair) + " " + show(pair[0] + pair[1]) + " " + pair.length;
}

function calledAfterReverse(): string {
  const state: [number, () => number] = [1, () => 2];
  state.reverse();
  try {
    return String(state[1]());
  } catch (error) {
    return "threw " + (error instanceof TypeError) + " " + typeof state[0] + " " + typeof state[1];
  }
}

function honest(i: number): number {
  const entry: Entry = [i, "a"];
  entry[0] = entry[0] + 1;
  entry[1] = entry[1] + "b";
  const [count, name] = entry;
  return count + name.length + entry.length;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += honest(i);
console.log("2000 honest rounds: " + total);
console.log("reversed: " + reversed());
console.log("popped: " + popped());
console.log("popped, then a method: " + poppedThenAMethod());
console.log("shifted: " + shifted());
console.log("pushed to: " + pushed());
console.log("filled: " + filled());
console.log("sorted: " + sorted());
console.log("spliced: " + spliced());
console.log("emptied: " + emptied());
console.log("copied within: " + copiedWithin());
console.log("read before and after: " + readBeforeAndAfter());
console.log("two numbers: " + twoNumbers());
console.log("called after a reverse: " + calledAfterReverse());

export {};

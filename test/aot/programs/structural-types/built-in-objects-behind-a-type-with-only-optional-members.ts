interface Weak {
  note?: string;
  size?: number;
  length?: number;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function forget(value: {}): Weak {
  return value;
}

function note(w: Weak): string {
  return w.note ?? "no note";
}

function sizes(w: Weak): string {
  return w.size + "/" + w.length;
}

function has(w: Weak): string {
  return ("note" in w) + " " + ("size" in w) + " " + ("length" in w) + " " + Object.hasOwn(w, "size") + " " + Object.hasOwn(w, "length");
}

function listing(w: Weak): string {
  let walked = "";
  for (const key in w) walked += key + ",";
  return Object.keys(w).join() + " | " + walked + " | " + Object.entries(w).length + " | " + Object.keys({ ...w }).join();
}

function rest(w: Weak): string {
  const { size, ...others } = w;
  return size + " " + Object.keys(others).join();
}

function write(w: Weak): string {
  w.note = "written";
  return note(w) + " " + Object.hasOwn(w, "note") + " " + Object.keys(w).join();
}

function remove(w: Weak): string {
  return delete w.note + " " + note(w);
}

function resize(w: Weak): string {
  w.size = 99;
  return String(w.size);
}

class Own {
  size = 5;
}

function two(a: number, b: number): number {
  return a + b;
}

const makers: [string, () => {}][] = [
  ["a literal", () => ({ note: "n", size: 1 })],
  ["an empty literal", () => ({})],
  ["an instance", () => new Own()],
  ["an array", () => [7, 8]],
  ["a map", () => new Map([[1, 2]])],
  ["a set", () => new Set([1, 2, 3])],
  ["a date", () => new Date(0)],
  ["a regular expression", () => /x/],
  ["an error", () => new Error("e")],
  ["a promise", () => Promise.resolve(1)],
  ["bytes", () => new Uint8Array(3)],
  ["a buffer", () => new ArrayBuffer(4)],
  ["a function", () => two],
  ["a class", () => Own],
  ["a bound function", () => two.bind(null, 1)],
  ["a string object", () => Object("ab")],
  ["a number object", () => Object(5)],
  ["Math", () => Math],
  ["a weak map", () => new WeakMap()],
  ["a generator", () => (function* () {})()],
  ["a proxy of a map", () => new Proxy(new Map(), {})],
];

const honest: Weak = { note: "n", size: 1 };
let warm = 0;
for (let i = 0; i < 2000; i++) warm += note(honest).length + sizes(honest).length + has(honest).length + listing(honest).length;
console.log("2000 honest: " + warm);

for (const [label, make] of makers) {
  attempt(label + ", note", () => note(forget(make())));
  attempt(label + ", sizes", () => sizes(forget(make())));
  attempt(label + ", has", () => has(forget(make())));
  attempt(label + ", listing", () => listing(forget(make())));
  attempt(label + ", rest", () => rest(forget(make())));
  if (label === "Math") continue;
  attempt(label + ", a store", () => write(forget(make())));
  attempt(label + ", a store and a delete", () => {
    const w = forget(make());
    write(w);
    return remove(w);
  });
  attempt(label + ", size stored", () => resize(forget(make())));
}

export {};

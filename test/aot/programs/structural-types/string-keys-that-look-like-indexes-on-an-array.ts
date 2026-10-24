function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

const none: Record<string, number> = {};

function fresh(): number[] & Record<string, number> {
  return Object.assign([10, 20, 30], none);
}

function read(list: number[] & Record<string, number>, key: string): number {
  return list[key];
}

function write(list: number[] & Record<string, number>, key: string, value: number): void {
  list[key] = value;
}

function state(list: number[]): string {
  return "length " + list.length + ", keys " + Object.keys(list).join("|") + ", " + (list.length < 10 ? JSON.stringify(list) : "long");
}

let total = 0;
const warm = fresh();
for (let i = 0; i < 2000; i++) {
  write(warm, String(i % 3), i);
  total += read(warm, String(i % 3)) + warm[i % 3];
}
console.log("2000 honest rounds: " + total);

const keys = ["1", "01", "1.0", "1.", "+1", " 1", "1 ", "1e0", "0x1", "-0", "-1", "1.5", "3", "4294967294", "4294967295", "4294967296", "9007199254740992", "NaN", "Infinity", "", "1n"];
for (const key of keys) {
  attempt("read " + show(key), () => {
    const list = fresh();
    return [typeof read(list, key), read(list, key), key in list];
  });
  attempt("write " + show(key), () => {
    const list = fresh();
    write(list, key, 7);
    return [state(list), read(list, key), list[1]];
  });
}

const list = fresh();
attempt("written out: reads", () => [list["1"], list["01"], list["1.0"], list["-0"], list["+1"], list["1e0"], list["4294967295"]]);
list["1"] = 21;
list["01"] = 1;
list["1.0"] = 2;
list["-0"] = 3;
list["+1"] = 4;
list["1e0"] = 5;
list["4294967295"] = 6;
console.log("written out: after seven stores: " + state(list));
attempt("written out: reads again", () => [list[1], list["1"], list["01"], list["1.0"], list[0], list["-0"], list["+1"], list["1e0"], list["4294967295"], list[4294967295]]);
attempt("the elements alone", () => [list.reduce((a, b) => a + b, 0), [...list], list.length]);
list["3"] = 40;
console.log("'3' appends: " + state(list));
list["length"] = 1;
console.log("'length' cuts: " + state(list));

attempt("narrowed by in", () => {
  const plain: number[] = [1, 2, 3];
  const seen: unknown[] = [];
  if ("1" in plain) seen.push(plain["1"]);
  if ("01" in plain) seen.push(plain["01"]);
  else seen.push("no 01");
  if ("length" in plain) seen.push(plain["length"]);
  return seen;
});
attempt("for in gives strings", () => {
  const plain: number[] = [5, 6];
  const seen: string[] = [];
  for (const key in plain) seen.push(typeof key + " " + key + " " + (plain[key] + 1) + " " + (key + 1));
  return seen;
});

export {};

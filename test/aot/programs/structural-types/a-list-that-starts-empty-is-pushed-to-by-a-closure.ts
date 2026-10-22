function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function pushedByAClosure(late: unknown, spoils: boolean): unknown {
  const list = [];
  const add = () => {
    list.push(late);
  };
  list.push(1);
  list.push(2);
  if (spoils) add();
  const numbers: number[] = list;
  let sum = 0;
  for (const n of numbers) sum += n;
  return [sum, total(numbers), numbers.map(n => n * 2), numbers.length];
}

function storedByIndexInAClosure(late: unknown, spoils: boolean): unknown {
  const list = [];
  const add = () => {
    list[5] = late;
  };
  list[0] = 1;
  list[1] = 2;
  if (spoils) add();
  const numbers: number[] = list;
  return [total(numbers), numbers, numbers.indexOf(2), numbers.includes(NaN)];
}

function objectsInTheList(late: unknown, spoils: boolean): unknown {
  const list = [];
  const add = () => {
    list.push(late);
  };
  list.push({ x: 1, y: 2 });
  if (spoils) add();
  let sum = 0;
  for (const p of list) sum += p.x + p.y;
  return [sum, list.map(p => p.x), list.length];
}

function textsInTheList(late: unknown, spoils: boolean): unknown {
  const list = [];
  const add = () => {
    list.unshift(late);
  };
  list.push("ab");
  if (spoils) add();
  const texts: string[] = list;
  return [texts.map(s => s.length), texts.join("+"), texts[0].length];
}

let shared = [];
function addToShared(late: unknown): void {
  shared.push(late);
}

function aModuleList(late: unknown, spoils: boolean): unknown {
  shared = [];
  shared.push(4);
  if (spoils) addToShared(late);
  const numbers: number[] = shared;
  return [total(numbers), numbers];
}

const cases: [string, (late: unknown, spoils: boolean) => unknown][] = [
  ["pushed", pushedByAClosure],
  ["stored far away", storedByIndexInAClosure],
  ["objects", objectsInTheList],
  ["texts", textsInTheList],
  ["a module list", aModuleList],
];

const late: [string, unknown][] = [
  ["a text", "3"],
  ["a fraction", 1.5],
  ["minus zero", -0],
  ["not a number", NaN],
  ["true", true],
  ["null", null],
  ["undefined", undefined],
  ["a bigint", 3n],
  ["a list", [3]],
  ["an object with valueOf", { valueOf: () => 3 }],
  ["other members", { y: "2", x: "1", length: 9 }],
];

console.log("honest callers: " + [total([1, 2]), total([]), total([0.5, 1.5])].join(" "));

for (const [name, run] of cases) {
  let rounds = 0;
  for (let i = 0; i < 2000; i++) {
    run(0, false);
    rounds++;
  }
  attempt(name + ", honest after " + rounds + " rounds", () => run(0, false));
  for (const [what, value] of late) attempt(name + ", " + what, () => run(value, true));
  attempt(name + ", honest again", () => run(0, false));
}

export {};

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const patterns: bigint[] = [
  0x7ff8000000000000n,
  0xfff8000000000000n,
  0x7ff8000000000001n,
  0x7ff0000000000001n,
  0xfff0000000000001n,
  0x7fffffffffffffffn,
  0xffffffffffffffffn,
  0xfffc000000000005n,
  0xfffe000000000000n,
  0xfffe000000001234n,
  0xfffe00000000000an,
  0xfffd000000000002n,
  0xfff9000000000007n,
  0x7ffc000000000000n,
  0x7ff8dead0000beefn,
  0xfffffffffffffffen,
];

class Cell {
  value: number = 0.5;
  other: number = 1;
  read(): number {
    return this.value;
  }
}

function describe(n: number): string {
  return typeof n + " " + n + " " + Number.isNaN(n) + " " + (n === undefined) + " " + (n ?? "nullish") + " " + (n ? "truthy" : "falsy") + " " + (n | 0) + " " + Object.is(n, NaN);
}

const bits = new BigUint64Array(1);
const floats = new Float64Array(bits.buffer);
const view = new DataView(bits.buffer);
const cell = new Cell();
const list: number[] = [0.5, 1.5];
let captured: number = 0.5;
const readCaptured = (): number => captured;

for (const pattern of patterns) {
  const label = pattern.toString(16);
  bits[0] = pattern;
  show(label + " element", () => describe(floats[0]));
  show(label + " data view", () => describe(view.getFloat64(0, true)));
  cell.value = floats[0];
  show(label + " field", () => describe(cell.read()));
  show(label + " field is there", () => "value" in cell && Object.keys(cell).join() === "value,other");
  show(label + " field as JSON", () => JSON.stringify(cell));
  list[0] = floats[0];
  show(label + " array element", () => describe(list[0]));
  show(label + " array element is there", () => 0 in list);
  captured = floats[0];
  show(label + " captured", () => describe(readCaptured()));
  show(label + " boxed", () => {
    const boxed: unknown[] = [floats[0]];
    return typeof boxed[0] + " " + String(boxed[0]);
  });
  show(label + " as a key", () => Object.keys({ [floats[0]]: 1 }).join());
  show(label + " in a map", () => new Map([[floats[0], "found"]]).get(NaN));
  show(label + " copied", () => describe(Array.from(floats)[0]));
  show(label + " sum", () => describe(floats[0] + cell.other));
}

const words = new Uint32Array(1);
const singles = new Float32Array(words.buffer);
for (const word of [0x7fc00000, 0xffc00000, 0x7f800001, 0xffffffff, 0x7fffffff, 0xfffe1234]) {
  words[0] = word;
  cell.value = singles[0];
  show(word.toString(16) + " single", () => describe(singles[0]));
  show(word.toString(16) + " single in a field", () => describe(cell.read()));
}
cell.value = 2;
show("a plain number afterwards", () => describe(cell.read()));

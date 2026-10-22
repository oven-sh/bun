class Reading {
  value: number;
  orNull: number | null;
  maybe?: number;
  constructor(value: number) {
    this.value = value;
    this.orNull = value;
    this.maybe = value;
  }
}

interface Sample {
  level: number;
  spare?: number;
}

function show(value: number | null | undefined): string {
  return Object.is(value, -0) ? "-0" : typeof value + " " + String(value);
}

function fromWords(high: number, low: number): number {
  return new Float64Array(new Uint32Array([low, high]).buffer)[0];
}

function fromFloatWord(bits: number): number {
  return new Float32Array(new Uint32Array([bits]).buffer)[0];
}

function fromView(high: number, low: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setUint32(0, high);
  view.setUint32(4, low);
  return view.getFloat64(0);
}

function valueOf(reading: Reading): number {
  return reading.value;
}

function orNullOf(reading: Reading): number | null {
  return reading.orNull;
}

function maybeOf(reading: Reading): number | undefined {
  return reading.maybe;
}

function maybeOrMinusOne(reading: Reading): number {
  return reading.maybe ?? -1;
}

function orNullOrMinusOne(reading: Reading): number {
  return reading.orNull === null ? -1 : reading.orNull;
}

function store(reading: Reading, value: number): void {
  reading.value = value;
  reading.orNull = value;
  reading.maybe = value;
}

function sumOf(values: number[]): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return total;
}

function describe(label: string, how: string, reading: Reading): void {
  console.log(
    label,
    how + ":",
    show(valueOf(reading)),
    "|",
    show(orNullOf(reading)),
    "|",
    show(maybeOf(reading)),
    "| or",
    show(maybeOrMinusOne(reading)),
    show(orNullOrMinusOne(reading)),
    "| in",
    "maybe" in reading,
    "| keys",
    Object.keys(reading).join(),
    "| json",
    JSON.stringify(reading),
  );
}

function report(label: string, value: number): void {
  const made = new Reading(value);
  const stored = new Reading(0.5);
  store(stored, value);
  const sample: Sample = { level: value, spare: value };
  const list: number[] = [0.5, value, 1.5];
  const grown: number[] = [];
  grown.push(0.25, value);
  describe(label, "made", made);
  describe(label, "stored", stored);
  console.log(
    label,
    "literal:",
    show(sample.level),
    show(sample.spare),
    "spare" in sample,
    JSON.stringify(sample),
    show({ ...sample }.spare),
  );
  console.log(
    label,
    "lists:",
    show(list[1]),
    1 in list,
    show(sumOf(list)),
    show(grown[1]),
    1 in grown,
    grown.length,
    JSON.stringify(list),
    list.includes(NaN),
    list.indexOf(value),
  );
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const reading = new Reading(i + 0.5);
  store(reading, i + 0.25);
  warm += valueOf(reading) + maybeOrMinusOne(reading) + orNullOrMinusOne(reading) + sumOf([i, 0.5]);
}
console.log("2000 honest readings:", warm);

const words: [number, number][] = [
  [0x7ff80000, 0],
  [0xfff80000, 0],
  [0x7ff00000, 1],
  [0x7ffa0000, 0],
  [0x7ffb0000, 0],
  [0x7ffc0000, 0],
  [0xfffa0000, 0],
  [0xfffc0000, 42],
  [0xfffe0000, 0],
  [0xfffe0000, 2],
  [0xfffe0000, 7],
  [0xfffe0000, 10],
  [0xffffffff, 0xffffffff],
];

for (const [high, low] of words) {
  const label = high.toString(16) + " " + low.toString(16);
  report("Float64Array " + label, fromWords(high, low));
  report("DataView " + label, fromView(high, low));
  report("negated " + label, -fromWords(high, low));
  report("plus one " + label, fromWords(high, low) + 1);
}
for (const bits of [0x7fc00000, 0x7fd00000, 0x7fd80000, 0x7fe00000, 0xffe00000, 0xfff00000])
  report("Float32Array " + bits.toString(16), fromFloatWord(bits));
report("honest again", 2.5);

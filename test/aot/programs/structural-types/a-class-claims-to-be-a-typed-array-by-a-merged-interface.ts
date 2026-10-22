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

interface Samples extends Float64Array {}
class Samples {
  id: number = 1;
}

interface Octets extends Uint8Array {}
class Octets {
  id: number = 2;
}

function total(list: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function firstOf(list: Float64Array): number {
  return list[0];
}

function store(list: Float64Array, index: number, value: number): number {
  list[index] = value;
  return list[index];
}

function firstOctet(list: Uint8Array): number {
  return list[0];
}

function storeOctet(list: Uint8Array, value: number): number {
  list[0] = value;
  return list[0];
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const real = new Float64Array([i, 0.5]);
  warm += total(real) + firstOf(real) + store(real, 1, 2) + firstOctet(new Uint8Array([i])) + storeOctet(new Uint8Array(1), i);
}
show("2000 honest rounds", () => warm);

const samples = new Samples();
show("length", () => samples.length);
show("byteLength", () => samples.byteLength);
show("buffer", () => samples.buffer);
show("first", () => firstOf(samples));
show("first plus one", () => firstOf(samples) + 1);
show("total", () => total(samples));
show("a store and a read", () => store(samples, 0, 1.5));
show("a store far out and a read", () => store(samples, 1000, 2.5));
show("keys", () => Object.keys(samples));
show("fill", () => samples.fill(1));
show("ArrayBuffer.isView", () => ArrayBuffer.isView(samples));
show("for of", () => {
  let sum = 0;
  for (const n of samples) sum += n;
  return sum;
});

const octets = new Octets();
show("octets: first", () => firstOctet(octets));
show("octets: 300 stays 300", () => storeOctet(octets, 300));
show("octets: a fraction stays a fraction", () => storeOctet(octets, 1.5));
show("octets: keys", () => Object.keys(octets));
show("honest again", () => [total(new Float64Array([1, 2])), storeOctet(new Uint8Array(1), 300), storeOctet(new Uint8Array(1), 1.5)]);

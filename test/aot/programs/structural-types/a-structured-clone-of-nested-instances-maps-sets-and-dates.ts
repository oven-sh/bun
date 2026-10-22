function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
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

class Wheel {
  size = 17;
  turn(): string {
    return "turning " + this.size;
  }
}

class Car {
  name = "car";
  wheels: Wheel[] = [new Wheel(), new Wheel()];
  spare: Wheel = this.wheels[0];
  built = new Date(86400000);
  owners = new Map<string, Wheel>([["first", this.wheels[1]]]);
  codes = new Set<number>([1, 2]);
  bytes = new Uint8Array([7, 8]);
  pattern = /a+/g;
  failure: Error = new RangeError("worn");
  big = 2n ** 70n;
  nothing: undefined = undefined;
  none: null = null;
  self: Car | null = null;
  drive(): string {
    return this.wheels.map(wheel => wheel.turn()).join();
  }
}

function sizes(car: Car): number[] {
  return car.wheels.map(wheel => wheel.size);
}

function firstTurn(car: Car): string {
  return car.wheels[0].turn();
}

function ownerSize(car: Car): number {
  return car.owners.get("first")?.size ?? -1;
}

function year(car: Car): number {
  return car.built.getUTCFullYear();
}

let warm = 0;
for (let i = 0; i < 1000; i++) {
  const honest = new Car();
  warm += sizes(honest).length + firstTurn(honest).length + ownerSize(honest) + year(honest) + honest.drive().length;
}
console.log("after 1000 honest cars", warm);

const source = new Car();
source.self = source;
const clone = structuredClone(source);

attempt("keys", () => Object.keys(clone));
attempt("sizes", () => sizes(clone));
attempt("a method of a nested instance", () => firstTurn(clone));
attempt("its own method", () => clone.drive());
attempt("classes", () => [clone instanceof Car, clone.wheels[0] instanceof Wheel, clone.wheels instanceof Array]);
attempt("what was shared is still shared", () => [clone.spare === clone.wheels[0], clone.owners.get("first") === clone.wheels[1], clone.spare === source.spare]);
attempt("the cycle", () => [clone.self === clone, clone.self === source]);
attempt("the date", () => [clone.built instanceof Date, year(clone), clone.built === source.built, clone.built.getTime()]);
attempt("the map", () => [clone.owners instanceof Map, clone.owners.size, ownerSize(clone)]);
attempt("the set", () => [clone.codes instanceof Set, [...clone.codes]]);
attempt("the bytes", () => [clone.bytes instanceof Uint8Array, [...clone.bytes], clone.bytes.buffer === source.bytes.buffer]);
attempt("the pattern", () => [clone.pattern instanceof RegExp, clone.pattern.source, clone.pattern.flags, clone.pattern.lastIndex]);
attempt("the error", () => [clone.failure instanceof RangeError, clone.failure instanceof Error, clone.failure.name, clone.failure.message]);
attempt("the rest", () => [clone.big, clone.nothing, clone.none, "nothing" in clone, clone.name]);
attempt("a store to the clone leaves the source alone", () => {
  clone.wheels[0].size = 20;
  clone.codes.add(3);
  clone.bytes[0] = 99;
  return [source.wheels[0].size, source.codes.size, source.bytes[0], clone.spare.size];
});
attempt("an array of instances", () => {
  const wheels = structuredClone([new Wheel(), new Wheel()]);
  return [wheels.length, wheels[0].size, typeof wheels[0].turn];
});
attempt("a map of instances", () => {
  const wheels = structuredClone(new Map([["a", new Wheel()]]));
  return [wheels.get("a")?.size, typeof wheels.get("a")?.turn];
});
attempt("holes, -0 and NaN survive", () => {
  const numbers = new Array<number>(3);
  numbers[1] = -0;
  const copy = structuredClone({ numbers, odd: NaN });
  return [0 in copy.numbers, copy.numbers, copy.odd];
});
attempt("honest again", () => [sizes(new Car()), firstTurn(new Car())]);

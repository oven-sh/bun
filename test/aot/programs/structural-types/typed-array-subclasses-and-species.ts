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

const log: string[] = [];

class Samples extends Float64Array {
  mean(): number {
    let total = 0;
    for (const value of this) total += value;
    return total / this.length;
  }
}

class Short extends Float64Array {
  static get [Symbol.species](): new (length: number) => Float64Array {
    return class extends Float64Array {
      constructor(length: number) {
        log.push("asked for " + length);
        super(Math.max(0, length - 1));
      }
    };
  }
}

class AsBytes extends Float64Array {
  static get [Symbol.species](): Uint8ArrayConstructor {
    return Uint8Array;
  }
}

class AsArray extends Float64Array {
  static get [Symbol.species](): ArrayConstructor {
    return Array;
  }
}

function nameOf(values: Float64Array): string {
  return values.constructor.name;
}

function sum(values: Float64Array): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return total;
}

function halves(values: Float64Array): Float64Array {
  return values.map(value => value / 2);
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum(new Float64Array([i, 0.5])) + sum(halves(new Float64Array([i]))) + nameOf(new Float64Array(1)).length;
console.log("after 2000 plain typed arrays", warm);

const uses: [string, (values: Float64Array) => Float64Array][] = [
  ["itself", values => values],
  ["map", halves],
  ["filter", values => values.filter(value => value > 1)],
  ["slice", values => values.slice(1)],
  ["subarray", values => values.subarray(1)],
  ["toSorted", values => values.toSorted()],
  ["toReversed", values => values.toReversed()],
  ["with", values => values.with(0, 9.5)],
  ["reverse", values => values.reverse()],
  ["structuredClone", values => structuredClone(values)],
];
const makers: [string, () => Float64Array][] = [
  ["samples", () => new Samples([1.5, 2.5, 300.5])],
  ["species that is too short", () => new Short([1.5, 2.5, 300.5])],
  ["species of bytes", () => new AsBytes([1.5, 2.5, 300.5])],
  ["species Array", () => new AsArray([1.5, 2.5, 300.5])],
];
for (const [name, make] of makers) {
  for (const [use, run] of uses) {
    log.length = 0;
    attempt(name + ": " + use, () => {
      const made = run(make());
      return [nameOf(made), made instanceof Samples, made.length, Array.from(made), sum(made), log.join()];
    });
  }
}
attempt("the method of a mapped one", () => {
  const mapped = new Samples([1, 2, 3]).map(value => value * 2);
  return mapped instanceof Samples ? mapped.mean() : "no samples";
});
attempt("Samples.from and Samples.of", () => [nameOf(Samples.from([1, 2])), nameOf(Samples.of(1, 2)), Samples.from([1, 2]) instanceof Samples]);
attempt("a subarray shares the buffer", () => {
  const samples = new Samples([1, 2, 3]);
  const part = samples.subarray(1);
  part[0] = 20;
  return [samples[1], part.buffer === samples.buffer, nameOf(part)];
});

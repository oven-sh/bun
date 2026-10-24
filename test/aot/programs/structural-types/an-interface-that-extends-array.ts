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

function inspect(numbers: number[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < numbers.length; i++) {
    const value = numbers[i];
    const exact = Object.is(value, undefined) ? "undefined" : Object.is(value, 0) ? "zero" : Object.is(value, -0) ? "minus zero" : Object.is(value, NaN) ? "not a number" : String(value);
    lines.push(i + " " + (i in numbers ? "present" : "absent") + " " + typeof value + " " + exact);
  }
  return lines;
}

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function sumByForOf(numbers: number[]): number {
  let total = 0;
  for (const number of numbers) total += number;
  return total;
}

function sumAsIntegers(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total = (total + numbers[i]) | 0;
  return total;
}

function doubled(numbers: number[]): number[] {
  return numbers.map(number => number * 2);
}

function doubledByHand(numbers: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < numbers.length; i++) result.push(numbers[i] * 2);
  return result;
}

function report(name: string, make: () => number[]): void {
  attempt(name + ": elements", () => inspect(make()));
  attempt(name + ": length", () => make().length);
  attempt(name + ": sum", () => sum(make()));
  attempt(name + ": sum by for-of", () => sumByForOf(make()));
  attempt(name + ": sum as integers", () => sumAsIntegers(make()));
  attempt(name + ": map", () => doubled(make()));
  attempt(name + ": doubled by hand", () => doubledByHand(make()));
  attempt(name + ": the first, fixed", () => make()[0].toFixed(1));
  attempt(name + ": after a push", () => {
    const numbers = make();
    const length = numbers.push(7);
    return [length, inspect(numbers), sum(numbers)];
  });
  attempt(name + ": after a store at 1", () => {
    const numbers = make();
    numbers[1] = 1.5;
    return [inspect(numbers), sum(numbers)];
  });
  attempt(name + ": keys", () => Object.keys(make()));
  attempt(name + ": JSON", () => JSON.stringify(make()));
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  for (const dense of [[i, 2, 3], [i + 0.5, 2.5, 3.5]]) {
    warm += inspect(dense).length + sum(dense) + sumByForOf(dense) + sumAsIntegers(dense) + doubled(dense)[0] + doubledByHand(dense)[1];
  }
}
console.log("after 4000 dense arrays", warm);

interface Series extends Array<number> {
  unit: string;
  mean(): number;
}

function makeSeries(values: number[], unit: string): Series {
  return Object.assign([...values], {
    unit,
    mean(this: number[]): number {
      return sum(this) / this.length;
    },
  });
}

class Samples extends Array<number> implements Series {
  unit = "samples";
  mean(): number {
    return sum(this) / this.length;
  }
}

function describe(series: Series): string {
  return series.length + " " + series.unit + " around " + series.mean();
}

function grow(series: Series): number {
  series.push(10);
  return series.length;
}

for (let i = 0; i < 2000; i++) warm += describe(makeSeries([i, 2], "m")).length + grow(makeSeries([i], "m"));
console.log("after 2000 series", warm);

attempt("describe", () => describe(makeSeries([1, 2, 3], "m")));
attempt("describe samples", () => {
  const samples = new Samples();
  samples.push(1, 2, 6);
  return describe(samples);
});
attempt("keys", () => Object.keys(makeSeries([1, 2], "m")));
attempt("keys of samples", () => Object.keys(Samples.from([1, 2])));
attempt("for-in", () => {
  const names: string[] = [];
  for (const name in makeSeries([1, 2], "m")) names.push(name);
  return names;
});
attempt("JSON leaves the members out", () => JSON.stringify(makeSeries([1, 2], "m")));
attempt("a copy by spread loses the members", () => Object.keys([...makeSeries([1, 2], "m")]));
attempt("map loses the members", () => Object.keys(makeSeries([1, 2], "m").map(value => value)));
attempt("map over samples keeps the class", () => {
  const mapped = Samples.from([1, 2]).map(value => value * 2);
  return [mapped.constructor.name, mapped instanceof Samples ? mapped.unit : "lost"];
});
attempt("grow", () => {
  const samples = new Samples();
  samples.push(1, 2);
  return [grow(makeSeries([1], "m")), grow(samples)];
});
attempt("the length is lowered", () => {
  const series = makeSeries([1, 2, 3], "m");
  series.length = 1;
  return [describe(series), series[1]];
});
report("a series as an array of numbers", () => makeSeries([1, 2, 3], "m"));
report("a series with a hole", () => {
  const series = makeSeries([1, 2, 3], "m");
  delete series[0];
  return series;
});
report("samples made with a length", () => new Samples(3));

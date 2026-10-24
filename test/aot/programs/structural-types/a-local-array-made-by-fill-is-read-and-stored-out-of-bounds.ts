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

function countPrimes(upTo: number): number {
  const crossedOut = new Array<boolean>(upTo + 1).fill(false);
  let primes = 0;
  for (let candidate = 2; candidate <= upTo; candidate++) {
    if (!crossedOut[candidate]) {
      primes++;
      let multiple = candidate * candidate;
      while (multiple <= upTo) {
        crossedOut[multiple] = true;
        multiple += candidate;
      }
    }
  }
  return primes;
}

function flagsPastTheEnd(size: number): unknown[] {
  const flags = new Array<boolean>(size).fill(false);
  return [flags[size], typeof flags[size], flags[size] === false, flags[-1], flags[0.5], flags.length];
}

function flagStoredPastTheEnd(size: number): unknown[] {
  const flags = new Array<boolean>(size).fill(false);
  flags[size + 1] = true;
  return [flags.length, flags[size], size in flags, flags[size + 1]];
}

function flagStoredBelowZero(size: number): unknown[] {
  const flags = new Array<boolean>(size).fill(true);
  flags[-1] = false;
  return [flags.length, flags[-1], flags[0]];
}

function countsPastTheEnd(size: number): unknown[] {
  const counts = new Array<number>(size).fill(0);
  for (let i = 0; i < 1000; i++) counts[i % size] = (counts[i % size] + 1) & 255;
  return [counts[0], counts[size - 1], counts[size], typeof counts[size], counts[size] + 1, counts[size] | 0, counts.length];
}

function countStoredPastTheEnd(size: number): unknown[] {
  const counts = new Array<number>(size).fill(0);
  counts[size + 2] = 7 & 255;
  let total = 0;
  for (let i = 0; i < counts.length; i++) total += counts[i];
  return [counts.length, total, size in counts];
}

function oneTooFar(size: number): number {
  const counts = new Array<number>(size).fill(1);
  let total = 0;
  for (let i = 0; i <= size; i++) total += counts[i];
  return total;
}

function bytesThatOverflow(size: number): number[] {
  const bytes = new Array<number>(size).fill(255);
  for (let i = 0; i < size; i++) bytes[i] = bytes[i] + i;
  return [bytes[0], bytes[1], bytes[size - 1]];
}

function smallThenLarge(size: number, large: number): number[] {
  const values = new Array<number>(size).fill(0);
  for (let i = 0; i < size; i++) values[i] = i & 7;
  values[0] = large;
  return [values[0], values[1], values[0] + values[1]];
}

function lengthOfMade(size: number): number {
  return new Array<number>(size).fill(0).length;
}

function filledWith(value: number): unknown[] {
  const values = new Array<number>(2).fill(value);
  return [values[0], values[1], Object.is(values[0], value), 0 in values];
}

function partlyFilled(): unknown[] {
  const values = new Array<number>(3).fill(0, 1);
  return [values[0], 0 in values, values[1], values[0] + values[1]];
}

function neverFilled(size: number): unknown[] {
  const values = new Array<number>(size);
  let total = 0;
  for (let i = 0; i < size; i++) total += values[i];
  return [total, values[0], 0 in values];
}

function shrunk(size: number): unknown[] {
  const values = new Array<number>(size).fill(1);
  values.length = 1;
  return [values.length, values[0], values[1], 1 in values];
}

function popped(): unknown[] {
  const flags = new Array<boolean>(2).fill(true);
  return [flags.pop(), flags.pop(), flags.pop(), flags.length];
}

attempt("primes below 100, 1000, 10000", () => [countPrimes(100), countPrimes(1000), countPrimes(10000)]);
attempt("primes below 0, 1, 2", () => [countPrimes(0), countPrimes(1), countPrimes(2)]);
for (const size of [1, 4, 100]) {
  attempt("size " + size + ": flags read past the end", () => flagsPastTheEnd(size));
  attempt("size " + size + ": a flag stored past the end", () => flagStoredPastTheEnd(size));
  attempt("size " + size + ": a flag stored below zero", () => flagStoredBelowZero(size));
  attempt("size " + size + ": counts read past the end", () => countsPastTheEnd(size));
  attempt("size " + size + ": a count stored past the end", () => countStoredPastTheEnd(size));
  attempt("size " + size + ": a loop that goes one too far", () => oneTooFar(size));
  attempt("size " + size + ": bytes that overflow", () => bytesThatOverflow(size));
  attempt("size " + size + ": never filled", () => neverFilled(size));
  attempt("size " + size + ": shrunk", () => shrunk(size));
}
for (const large of [255, 256, -1, -129, 65536, 2 ** 31, -(2 ** 31) - 1, 0.5, NaN, -0, Infinity]) attempt("small values, then " + show(large), () => smallThenLarge(4, large));
for (const size of [0, -1, 1.5, NaN, 2 ** 32, -0]) attempt("made with the length " + show(size), () => lengthOfMade(size));
for (const value of [0, -0, 1, 255, 256, -1, 0.5, NaN]) attempt("filled with " + show(value), () => filledWith(value));
attempt("partly filled", partlyFilled);
attempt("popped", popped);

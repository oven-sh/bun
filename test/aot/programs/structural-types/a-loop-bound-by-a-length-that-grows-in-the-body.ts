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

function doubled(numbers: number[], limit: number): number {
  let sum = 0;
  for (let i = 0; i < numbers.length; i++) {
    sum += numbers[i];
    if (numbers.length < limit) numbers.push(numbers[i] * 2);
  }
  return sum;
}

function cachedBound(numbers: number[]): number {
  let sum = 0;
  for (let i = 0, n = numbers.length; i < n; i++) {
    sum += numbers[i];
    numbers.push(100);
  }
  return sum;
}

function byForOf(numbers: number[], limit: number): number {
  let sum = 0;
  for (const n of numbers) {
    sum += n;
    if (numbers.length < limit) numbers.push(n + 0.5);
  }
  return sum;
}

function byLengthStore(numbers: number[], limit: number): string {
  let kinds = "";
  for (let i = 0; i < numbers.length; i++) {
    kinds += typeof numbers[i] + " ";
    if (numbers.length < limit) numbers.length += 1;
  }
  return kinds;
}

function farStore(numbers: number[]): unknown[] {
  let sum = 0;
  let rounds = 0;
  for (let i = 0; i < numbers.length; i++) {
    rounds++;
    sum += numbers[i];
    if (i === 0) numbers[5] = 1;
  }
  return [rounds, sum];
}

function unshifted(strings: string[], limit: number): string {
  let text = "";
  for (let i = 0; i < strings.length; i++) {
    text += strings[i].toUpperCase();
    if (strings.length < limit) strings.unshift("n" + i);
  }
  return text;
}

function growingText(text: string, limit: number): string {
  let seen = "";
  for (let i = 0; i < text.length; i++) {
    seen += text[i];
    if (text.length < limit) text += String(i);
  }
  return seen + " " + text.length;
}

function queue(start: number): number[] {
  const work = [start];
  const order: number[] = [];
  for (let i = 0; i < work.length; i++) {
    const n = work[i];
    order.push(n);
    if (n > 1) work.push(n >> 1, n - (n >> 1));
  }
  return order;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += doubled([1, 2], 2) + cachedBound([i]) + byForOf([i], 1) + queue(1).length;
console.log("2000 rounds in which nothing grows: " + total);

attempt("pushed to in the body", () => {
  const numbers = [1];
  return [doubled(numbers, 6), numbers];
});
attempt("pushed to, the bound was read once", () => {
  const numbers = [1, 2, 3];
  return [cachedBound(numbers), numbers];
});
attempt("pushed to under for of", () => {
  const numbers = [1];
  return [byForOf(numbers, 5), numbers];
});
attempt("integers get fractions under for of", () => {
  const numbers = [1, 2, 3];
  return [byForOf(numbers, 6), numbers];
});
attempt("the length is stored to in the body", () => {
  const numbers = [1];
  return [byLengthStore(numbers, 4), numbers];
});
attempt("a store far past the end in the body", () => {
  const numbers = [1, 2];
  return [farStore(numbers), numbers];
});
attempt("put in front in the body", () => {
  const strings = ["a", "b"];
  return [unshifted(strings, 5), strings];
});
attempt("a text grows in the body", () => [growingText("ab", 6), growingText("", 3), growingText("x", 1)]);
attempt("a work list", () => queue(5));

export {};

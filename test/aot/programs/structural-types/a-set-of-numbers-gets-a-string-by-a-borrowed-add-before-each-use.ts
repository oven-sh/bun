function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + show(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

attempt("size", () => {
  const set = new Set<number>([1, 2, 3]);
  Set.prototype.add.call(set, "text");
  return set.size;
});
attempt("has 2", () => {
  const set = new Set<number>([1, 2, 3]);
  Set.prototype.add.call(set, "text");
  return set.has(2);
});
attempt("for-of", () => {
  const set = new Set<number>([1, 2, 3]);
  Set.prototype.add.call(set, "text");
  return (() => {
    let kinds = "";
    for (const value of set) kinds += typeof value + ",";
    return kinds;
  })();
});
attempt("summed", () => {
  const set = new Set<number>([1, 2, 3]);
  Set.prototype.add.call(set, "text");
  return (() => {
    let total = 0;
    for (const value of set) total += value;
    return total;
  })();
});
attempt("mapped", () => {
  const set = new Set<number>([1, 2, 3]);
  Set.prototype.add.call(set, "text");
  return [...set].map(value => value + 1).join();
});
attempt("filtered", () => {
  const set = new Set<number>([1, 2, 3]);
  Set.prototype.add.call(set, "text");
  return [...set].filter(value => typeof value === "number").length;
});
attempt("searched", () => {
  const set = new Set<number>([1, 2, 3]);
  Set.prototype.add.call(set, "text");
  return [...set].findIndex(value => value === undefined);
});
attempt("forEach", () => {
  const set = new Set<number>([1, 2, 3]);
  Set.prototype.add.call(set, "text");
  return (() => {
    let kinds = "";
    set.forEach(value => {
      kinds += typeof value + ",";
    });
    return kinds;
  })();
});
attempt("the largest", () => {
  const set = new Set<number>([1, 2, 3]);
  Set.prototype.add.call(set, "text");
  return Math.max(...set);
});
attempt("Array.from", () => {
  const set = new Set<number>([1, 2, 3]);
  Set.prototype.add.call(set, "text");
  return Array.from(set, value => typeof value).join();
});
attempt("json", () => {
  const set = new Set<number>([1, 2, 3]);
  Set.prototype.add.call(set, "text");
  return JSON.stringify([...set]);
});

export {};

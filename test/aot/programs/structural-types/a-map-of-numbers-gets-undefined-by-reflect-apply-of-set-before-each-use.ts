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

attempt("get", () => {
  const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
  Reflect.apply(Map.prototype.set, map, ["b", undefined]);
  return map.get("b");
});
attempt("typeof", () => {
  const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
  Reflect.apply(Map.prototype.set, map, ["b", undefined]);
  return typeof map.get("b");
});
attempt("is undefined", () => {
  const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
  Reflect.apply(Map.prototype.set, map, ["b", undefined]);
  return map.get("b") === undefined;
});
attempt("plus one", () => {
  const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
  Reflect.apply(Map.prototype.set, map, ["b", undefined]);
  return (map.get("b") ?? 0) + 1;
});
attempt("has", () => {
  const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
  Reflect.apply(Map.prototype.set, map, ["b", undefined]);
  return map.has("b");
});
attempt("size", () => {
  const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
  Reflect.apply(Map.prototype.set, map, ["b", undefined]);
  return map.size;
});
attempt("for-of", () => {
  const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
  Reflect.apply(Map.prototype.set, map, ["b", undefined]);
  return (() => {
    let kinds = "";
    for (const [, value] of map) kinds += typeof value + ",";
    return kinds;
  })();
});
attempt("summed", () => {
  const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
  Reflect.apply(Map.prototype.set, map, ["b", undefined]);
  return (() => {
    let total = 0;
    for (const value of map.values()) total += value;
    return total;
  })();
});
attempt("forEach", () => {
  const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
  Reflect.apply(Map.prototype.set, map, ["b", undefined]);
  return (() => {
    let kinds = "";
    map.forEach(value => {
      kinds += typeof value + ",";
    });
    return kinds;
  })();
});
attempt("values mapped", () => {
  const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
  Reflect.apply(Map.prototype.set, map, ["b", undefined]);
  return [...map.values()].map(value => value + 1).join();
});
attempt("values filtered", () => {
  const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
  Reflect.apply(Map.prototype.set, map, ["b", undefined]);
  return [...map.values()].filter(value => typeof value === "number").length;
});
attempt("values searched", () => {
  const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
  Reflect.apply(Map.prototype.set, map, ["b", undefined]);
  return [...map.values()].findIndex(value => value === undefined);
});
attempt("entries", () => {
  const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
  Reflect.apply(Map.prototype.set, map, ["b", undefined]);
  return [...map].join("|");
});
attempt("Array.from", () => {
  const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
  Reflect.apply(Map.prototype.set, map, ["b", undefined]);
  return Array.from(map.values(), value => typeof value).join();
});
attempt("the largest", () => {
  const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
  Reflect.apply(Map.prototype.set, map, ["b", undefined]);
  return Math.max(...map.values());
});
attempt("an object of it", () => {
  const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
  Reflect.apply(Map.prototype.set, map, ["b", undefined]);
  return JSON.stringify(Object.fromEntries(map));
});
attempt("a typed store", () => {
  const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
  Reflect.apply(Map.prototype.set, map, ["b", undefined]);
  return map.set("b", 5).get("b");
});

export {};

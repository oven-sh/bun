interface Part {
  depth: number;
}

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

attempt("typeof", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return typeof list[1];
});
attempt("is undefined", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return list[1] === undefined;
});
attempt("is truthy", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return !!list[1];
});
attempt("its member", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return list[1].depth;
});
attempt("an optional chain", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return list[1]?.depth;
});
attempt("in", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return 1 in list;
});
attempt("for-of", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return (() => {
    let total = 0;
    for (const part of list) total += part.depth;
    return total;
  })();
});
attempt("map to kinds", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return list.map(part => typeof part).join();
});
attempt("map to members", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return list.map(part => part.depth).join();
});
attempt("filter undefined", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return list.filter(part => part === undefined).length;
});
attempt("filter objects", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return list.filter(part => typeof part === "object" && part !== null).length;
});
attempt("filter by truth", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return list.filter(part => part).length;
});
attempt("findIndex", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return list.findIndex(part => !part);
});
attempt("some", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return list.some(part => part == null);
});
attempt("every", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return list.every(part => part instanceof Object);
});
attempt("reduce", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return list.reduce((sum, part) => sum + part.depth, 0);
});
attempt("a pattern in a callback", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return list.map(({ depth }) => depth).join();
});
attempt("json", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return JSON.stringify(list);
});
attempt("spread", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return [...list].length;
});
attempt("a default in a pattern", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return (([, b = { depth: -1 }]: Part[]) => b.depth)(list);
});
attempt("toSorted", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return list.toSorted((a, b) => b.depth - a.depth).length;
});
attempt("a typed store", () => {
  const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
  Reflect.set(list, 1, undefined);
  return (list[1] = { depth: 9 }).depth + " " + JSON.stringify(list);
});

export {};

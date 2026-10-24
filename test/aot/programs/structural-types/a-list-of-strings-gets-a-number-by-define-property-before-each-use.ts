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

attempt("read", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list[1];
});
attempt("typeof", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return typeof list[1];
});
attempt("is undefined", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list[1] === undefined;
});
attempt("is a string", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return typeof list[1] === "string";
});
attempt("its length", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list[1].length;
});
attempt("glued", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list[1] + "!";
});
attempt("in", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return 1 in list;
});
attempt("length", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list.length;
});
attempt("for-of", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return (() => {
    let kinds = "";
    for (const s of list) kinds += typeof s + ",";
    return kinds;
  })();
});
attempt("map to kinds", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list.map(s => typeof s).join();
});
attempt("map to lengths", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list.map(s => s.length).join();
});
attempt("map to capitals", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list.map(s => s.toUpperCase()).join();
});
attempt("filter undefined", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list.filter(s => s === undefined).length;
});
attempt("filter strings", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list.filter(s => typeof s === "string").length;
});
attempt("findIndex", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list.findIndex(s => typeof s !== "string");
});
attempt("some", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list.some(s => s == null);
});
attempt("every", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list.every(s => typeof s === "string");
});
attempt("reduce", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list.reduce((a, b) => a + b, "");
});
attempt("indexOf", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list.indexOf("c");
});
attempt("includes", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list.includes("c");
});
attempt("join", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list.join("+");
});
attempt("json", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return JSON.stringify(list);
});
attempt("toSorted", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list.toSorted().join();
});
attempt("sort", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return list.sort().join();
});
attempt("spread", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return [...list].map(s => typeof s).join();
});
attempt("a default in a pattern", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return (([, b = "default"]: string[]) => b)(list);
});
attempt("a set", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return new Set(list).size;
});
attempt("a template", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return `${list[0]}${list[1]}`;
});
attempt("a typed store", () => {
  const list: string[] = ["a", "b", "c"];
  Object.defineProperty(list, 1, { value: 7 });
  return (list[1] = "z") + " " + list.join();
});

export {};

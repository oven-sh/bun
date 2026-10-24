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

attempt("read by name", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return scores.b;
});
attempt("read by a key", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return scores["b"];
});
attempt("typeof", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return typeof scores.b;
});
attempt("is undefined", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return scores.b === undefined;
});
attempt("is a number", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return typeof scores.b === "number";
});
attempt("plus one", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return scores.b + 1;
});
attempt("in", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return "b" in scores;
});
attempt("keys", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return Object.keys(scores).join();
});
attempt("values to kinds", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return Object.values(scores).map(value => typeof value).join();
});
attempt("values plus one", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return Object.values(scores).map(value => value + 1).join();
});
attempt("values filtered", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return Object.values(scores).filter(value => typeof value === "number").length;
});
attempt("values searched", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return Object.values(scores).findIndex(value => value === undefined);
});
attempt("values summed", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return Object.values(scores).reduce((a, b) => a + b, 0);
});
attempt("entries filtered", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return Object.entries(scores).filter(([, value]) => typeof value === "number").length;
});
attempt("entries mapped", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return Object.entries(scores).map(([key, value]) => key + (value + 1)).join();
});
attempt("for-in", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return (() => {
    let total = 0;
    for (const key in scores) total += scores[key];
    return total;
  })();
});
attempt("json", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return JSON.stringify(scores);
});
attempt("a copy", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return JSON.stringify({ ...scores });
});
attempt("a copy read", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return ({ ...scores }).b + 1;
});
attempt("a pattern", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return (({ b }: Record<string, number>) => b + 1)(scores);
});
attempt("the largest", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return Math.max(...Object.values(scores));
});
attempt("a typed store", () => {
  const scores: Record<string, number> = { a: 1, b: 2, c: 3 };
  Reflect.deleteProperty(scores, "b");
  return (scores.b = 5) + " " + JSON.stringify(scores);
});

export {};

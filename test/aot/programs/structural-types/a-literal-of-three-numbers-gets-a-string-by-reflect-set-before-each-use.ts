interface Triple {
  a: number;
  b: number;
  c: number;
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

attempt("read by name", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return scores.b;
});
attempt("typeof", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return typeof scores.b;
});
attempt("is undefined", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return scores.b === undefined;
});
attempt("is a number", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return typeof scores.b === "number";
});
attempt("plus one", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return scores.b + 1;
});
attempt("in", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return "b" in scores;
});
attempt("keys", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return Object.keys(scores).join();
});
attempt("values to kinds", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return Object.values(scores).map(value => typeof value).join();
});
attempt("values plus one", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return Object.values(scores).map(value => value + 1).join();
});
attempt("values filtered", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return Object.values(scores).filter(value => typeof value === "number").length;
});
attempt("values searched", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return Object.values(scores).findIndex(value => value === undefined);
});
attempt("values summed", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return Object.values(scores).reduce((a, b) => a + b, 0);
});
attempt("entries filtered", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return Object.entries(scores).filter(([, value]) => typeof value === "number").length;
});
attempt("entries mapped", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return Object.entries(scores).map(([key, value]) => key + (value + 1)).join();
});
attempt("json", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return JSON.stringify(scores);
});
attempt("a copy", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return JSON.stringify({ ...scores });
});
attempt("a copy read", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return ({ ...scores }).b + 1;
});
attempt("a pattern", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return (({ b }: Triple) => b + 1)(scores);
});
attempt("the largest", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return Math.max(...Object.values(scores));
});
attempt("a typed store", () => {
  const scores: Triple = { a: 1, b: 2, c: 3 };
  Reflect.set(scores, "b", "text");
  return (scores.b = 5) + " " + JSON.stringify(scores);
});

export {};

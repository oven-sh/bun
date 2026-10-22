function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

class C1 {
  id = 1;
  value?: string = "s";
}

function ask1(o: C1): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value;
}

function block1(): void {
  const o = new C1();
  Reflect.deleteProperty(o, "value");
  attempt("an optional field is deleted, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
  attempt("an optional field is deleted, asked by a typed function", () => ask1(o));
  attempt("an optional field is deleted, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "string").length);
  attempt("an optional field is deleted, used", () => o.value?.length);
  attempt("an optional field is deleted, or a default", () => o.value ?? "default");
  attempt("an optional field is deleted, listed", () => ("value" in o) + " " + Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("an optional field is deleted, a typed store", () => (o.value = "t"));
  attempt("an optional field is deleted, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
}

block1();

class C2 {
  readonly value: number = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask2(o: C2): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block2(): void {
  const o = new C2();
  Reflect.deleteProperty(o, "value");
  attempt("a readonly field is deleted, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("a readonly field is deleted, asked by a typed function", () => ask2(o));
  attempt("a readonly field is deleted, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("a readonly field is deleted, used", () => o.value + 1);
  attempt("a readonly field is deleted, by its own method", () => o.twice());
  attempt("a readonly field is deleted, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
}

block2();

export {};

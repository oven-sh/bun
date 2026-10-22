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
  Object.defineProperty(o, "value", { value: undefined });
  attempt("an optional field becomes undefined, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
  attempt("an optional field becomes undefined, asked by a typed function", () => ask1(o));
  attempt("an optional field becomes undefined, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "string").length);
  attempt("an optional field becomes undefined, used", () => o.value?.length);
  attempt("an optional field becomes undefined, or a default", () => o.value ?? "default");
  attempt("an optional field becomes undefined, listed", () => ("value" in o) + " " + Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("an optional field becomes undefined, a typed store", () => (o.value = "t"));
  attempt("an optional field becomes undefined, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
}

block1();

class C2 {
  id = 1;
  value?: string = "s";
}

function ask2(o: C2): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value;
}

function block2(): void {
  const o = new C2();
  Object.defineProperty(o, "value", { value: 7 });
  attempt("an optional field becomes a value of another kind, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
  attempt("an optional field becomes a value of another kind, asked by a typed function", () => ask2(o));
  attempt("an optional field becomes a value of another kind, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "string").length);
  attempt("an optional field becomes a value of another kind, used", () => o.value?.length);
  attempt("an optional field becomes a value of another kind, or a default", () => o.value ?? "default");
  attempt("an optional field becomes a value of another kind, listed", () => ("value" in o) + " " + Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("an optional field becomes a value of another kind, a typed store", () => (o.value = "t"));
  attempt("an optional field becomes a value of another kind, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
}

block2();

class C3 {
  readonly value: number = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask3(o: C3): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block3(): void {
  const o = new C3();
  Object.defineProperty(o, "value", { value: undefined });
  attempt("a readonly field becomes undefined, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("a readonly field becomes undefined, asked by a typed function", () => ask3(o));
  attempt("a readonly field becomes undefined, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("a readonly field becomes undefined, used", () => o.value + 1);
  attempt("a readonly field becomes undefined, by its own method", () => o.twice());
  attempt("a readonly field becomes undefined, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
}

block3();

class C4 {
  readonly value: number = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask4(o: C4): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block4(): void {
  const o = new C4();
  Object.defineProperty(o, "value", { value: "text" });
  attempt("a readonly field becomes a value of another kind, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("a readonly field becomes a value of another kind, asked by a typed function", () => ask4(o));
  attempt("a readonly field becomes a value of another kind, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("a readonly field becomes a value of another kind, used", () => o.value + 1);
  attempt("a readonly field becomes a value of another kind, by its own method", () => o.twice());
  attempt("a readonly field becomes a value of another kind, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
}

block4();

export {};

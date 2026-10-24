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
  level = 1;
  value(): number {
    return this.level;
  }
}

function ask1(o: C1): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value;
}

function block1(): void {
  const o = new C1();
  Reflect.deleteProperty(C1.prototype, "value");
  attempt("a method of a prototype is deleted, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
  attempt("a method of a prototype is deleted, asked by a typed function", () => ask1(o));
  attempt("a method of a prototype is deleted, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("a method of a prototype is deleted, used", () => o.value());
  attempt("a method of a prototype is deleted, on a new instance", () => new C1().value());
  attempt("a method of a prototype is deleted, listed", () => Object.hasOwn(o, "value") + " " + Object.getOwnPropertyNames(C1.prototype).join());
  attempt("a method of a prototype is deleted, a typed store", () => (o.value = () => 2));
  attempt("a method of a prototype is deleted, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
}

block1();

class C2 {
  static value = 1;
  static twice(): number {
    return C2.value * 2;
  }
}

function ask2(o: typeof C2): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block2(): void {
  Reflect.deleteProperty(C2, "value");
  attempt("a static field is deleted, asked directly", () => (C2.value === undefined) + " " + (C2.value == null) + " " + (typeof C2.value === "number") + " " + typeof C2.value);
  attempt("a static field is deleted, asked by a typed function", () => ask2(C2));
  attempt("a static field is deleted, asked by a callback", () => [C2].filter(q => q.value === undefined).length + " " + [C2].filter(q => typeof q.value === "number").length);
  attempt("a static field is deleted, used", () => C2.value + 1);
  attempt("a static field is deleted, by a static method", () => C2.twice());
  attempt("a static field is deleted, listed", () => Object.keys(C2).join());
  attempt("a static field is deleted, a typed store", () => (C2.value = 5));
  attempt("a static field is deleted, asked after the store", () => (C2.value === undefined) + " " + (C2.value == null) + " " + (typeof C2.value === "number") + " " + typeof C2.value);
}

block2();

function ask3(o: { value: number }): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block3(): void {
  const f = Object.assign((n: number): number => n * 2, { value: 1 });
  Reflect.deleteProperty(f, "value");
  attempt("a member of a function is deleted, asked directly", () => (f.value === undefined) + " " + (f.value == null) + " " + (typeof f.value === "number") + " " + typeof f.value);
  attempt("a member of a function is deleted, asked by a typed function", () => ask3(f));
  attempt("a member of a function is deleted, asked by a callback", () => [f].filter(q => q.value === undefined).length + " " + [f].filter(q => typeof q.value === "number").length);
  attempt("a member of a function is deleted, used", () => f.value + 1);
  attempt("a member of a function is deleted, called", () => f(2));
  attempt("a member of a function is deleted, listed", () => Object.keys(f).join());
  attempt("a member of a function is deleted, a typed store", () => (f.value = 5));
  attempt("a member of a function is deleted, asked after the store", () => (f.value === undefined) + " " + (f.value == null) + " " + (typeof f.value === "number") + " " + typeof f.value);
}

block3();

export {};

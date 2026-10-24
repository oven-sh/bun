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
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask1(o: C1): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block1(): void {
  const o = new C1();
  Reflect.deleteProperty(o, "value");
  attempt("a number field is deleted, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("a number field is deleted, asked by a typed function", () => ask1(o));
  attempt("a number field is deleted, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("a number field is deleted, used", () => o.value + 1);
  attempt("a number field is deleted, by its own method", () => o.twice());
  attempt("a number field is deleted, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a number field is deleted, a typed store", () => (o.value = 5));
  attempt("a number field is deleted, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
}

block1();

class C2 {
  value = "s";
  size(): number {
    return this.value.length;
  }
}

function ask2(o: C2): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value;
}

function block2(): void {
  const o = new C2();
  Reflect.deleteProperty(o, "value");
  attempt("a string field is deleted, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
  attempt("a string field is deleted, asked by a typed function", () => ask2(o));
  attempt("a string field is deleted, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "string").length);
  attempt("a string field is deleted, used", () => o.value.length);
  attempt("a string field is deleted, by its own method", () => o.size());
  attempt("a string field is deleted, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a string field is deleted, a typed store", () => (o.value = "t"));
  attempt("a string field is deleted, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
}

block2();

class C3 {
  value = true;
  word(): string {
    return this.value ? "yes" : "no";
  }
}

function ask3(o: C3): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value;
}

function block3(): void {
  const o = new C3();
  Reflect.deleteProperty(o, "value");
  attempt("a boolean field is deleted, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value);
  attempt("a boolean field is deleted, asked by a typed function", () => ask3(o));
  attempt("a boolean field is deleted, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "boolean").length);
  attempt("a boolean field is deleted, used", () => o.value ? "truthy" : "falsy");
  attempt("a boolean field is deleted, by its own method", () => o.word());
  attempt("a boolean field is deleted, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a boolean field is deleted, a typed store", () => (o.value = false));
  attempt("a boolean field is deleted, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value);
}

block3();

export {};

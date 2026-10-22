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

interface C1 {
  value1: number;
  other1: number;
}

function ask1(o: C1): string {
  return (o.value1 === undefined) + " " + (o.value1 == null) + " " + (typeof o.value1 === "number") + " " + typeof o.value1;
}

function block1(): void {
  const o: C1 = { value1: 1, other1: 2 };
  Reflect.deleteProperty(o, "value1");
  attempt("a member of a literal is deleted, asked directly", () => (o.value1 === undefined) + " " + (o.value1 == null) + " " + (typeof o.value1 === "number") + " " + typeof o.value1);
  attempt("a member of a literal is deleted, asked by a typed function", () => ask1(o));
  attempt("a member of a literal is deleted, asked by a callback", () => [o].filter(q => q.value1 === undefined).length + " " + [o].filter(q => typeof q.value1 === "number").length);
  attempt("a member of a literal is deleted, used", () => o.value1 + o.other1);
  attempt("a member of a literal is deleted, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a member of a literal is deleted, copied", () => JSON.stringify({ ...o }));
  attempt("a member of a literal is deleted, a typed store", () => (o.value1 = 5));
  attempt("a member of a literal is deleted, asked after the store", () => (o.value1 === undefined) + " " + (o.value1 == null) + " " + (typeof o.value1 === "number") + " " + typeof o.value1);
}

block1();

class B2 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

class C2 extends B2 {
  extra = 2;
}

function ask2(o: B2): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block2(): void {
  const o = new C2();
  Reflect.deleteProperty(o, "value");
  attempt("an inherited field is deleted, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("an inherited field is deleted, asked by a typed function", () => ask2(o));
  attempt("an inherited field is deleted, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("an inherited field is deleted, used", () => o.value + o.extra);
  attempt("an inherited field is deleted, by the method of the base", () => o.twice());
  attempt("an inherited field is deleted, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("an inherited field is deleted, a typed store", () => (o.value = 5));
  attempt("an inherited field is deleted, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
}

block2();

export {};

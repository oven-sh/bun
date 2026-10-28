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
  Reflect.defineProperty(o, "value1", { value: undefined });
  attempt("a member of a literal becomes undefined, asked directly", () => (o.value1 === undefined) + " " + (o.value1 == null) + " " + (typeof o.value1 === "number") + " " + typeof o.value1);
  attempt("a member of a literal becomes undefined, asked by a typed function", () => ask1(o));
  attempt("a member of a literal becomes undefined, asked by a callback", () => [o].filter(q => q.value1 === undefined).length + " " + [o].filter(q => typeof q.value1 === "number").length);
  attempt("a member of a literal becomes undefined, used", () => o.value1 + o.other1);
  attempt("a member of a literal becomes undefined, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a member of a literal becomes undefined, copied", () => JSON.stringify({ ...o }));
  attempt("a member of a literal becomes undefined, a typed store", () => (o.value1 = 5));
  attempt("a member of a literal becomes undefined, asked after the store", () => (o.value1 === undefined) + " " + (o.value1 == null) + " " + (typeof o.value1 === "number") + " " + typeof o.value1);
}

block1();

interface C2 {
  value2: number;
  other2: number;
}

function ask2(o: C2): string {
  return (o.value2 === undefined) + " " + (o.value2 == null) + " " + (typeof o.value2 === "number") + " " + typeof o.value2;
}

function block2(): void {
  const o: C2 = { value2: 1, other2: 2 };
  Reflect.defineProperty(o, "value2", { value: "text" });
  attempt("a member of a literal becomes a value of another kind, asked directly", () => (o.value2 === undefined) + " " + (o.value2 == null) + " " + (typeof o.value2 === "number") + " " + typeof o.value2);
  attempt("a member of a literal becomes a value of another kind, asked by a typed function", () => ask2(o));
  attempt("a member of a literal becomes a value of another kind, asked by a callback", () => [o].filter(q => q.value2 === undefined).length + " " + [o].filter(q => typeof q.value2 === "number").length);
  attempt("a member of a literal becomes a value of another kind, used", () => o.value2 + o.other2);
  attempt("a member of a literal becomes a value of another kind, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a member of a literal becomes a value of another kind, copied", () => JSON.stringify({ ...o }));
  attempt("a member of a literal becomes a value of another kind, a typed store", () => (o.value2 = 5));
  attempt("a member of a literal becomes a value of another kind, asked after the store", () => (o.value2 === undefined) + " " + (o.value2 == null) + " " + (typeof o.value2 === "number") + " " + typeof o.value2);
}

block2();

class B3 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

class C3 extends B3 {
  extra = 2;
}

function ask3(o: B3): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block3(): void {
  const o = new C3();
  Reflect.defineProperty(o, "value", { value: undefined });
  attempt("an inherited field becomes undefined, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("an inherited field becomes undefined, asked by a typed function", () => ask3(o));
  attempt("an inherited field becomes undefined, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("an inherited field becomes undefined, used", () => o.value + o.extra);
  attempt("an inherited field becomes undefined, by the method of the base", () => o.twice());
  attempt("an inherited field becomes undefined, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("an inherited field becomes undefined, a typed store", () => (o.value = 5));
  attempt("an inherited field becomes undefined, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
}

block3();

class B4 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

class C4 extends B4 {
  extra = 2;
}

function ask4(o: B4): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block4(): void {
  const o = new C4();
  Reflect.defineProperty(o, "value", { value: "text" });
  attempt("an inherited field becomes a value of another kind, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("an inherited field becomes a value of another kind, asked by a typed function", () => ask4(o));
  attempt("an inherited field becomes a value of another kind, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("an inherited field becomes a value of another kind, used", () => o.value + o.extra);
  attempt("an inherited field becomes a value of another kind, by the method of the base", () => o.twice());
  attempt("an inherited field becomes a value of another kind, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("an inherited field becomes a value of another kind, a typed store", () => (o.value = 5));
  attempt("an inherited field becomes a value of another kind, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
}

block4();

export {};

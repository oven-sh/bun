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
  Object.freeze(o);
  attempt("the holder of an optional field is frozen, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
  attempt("the holder of an optional field is frozen, asked by a typed function", () => ask1(o));
  attempt("the holder of an optional field is frozen, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "string").length);
  attempt("the holder of an optional field is frozen, used", () => o.value?.length);
  attempt("the holder of an optional field is frozen, or a default", () => o.value ?? "default");
  attempt("the holder of an optional field is frozen, listed", () => ("value" in o) + " " + Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of an optional field is frozen, a typed store", () => (o.value = "t"));
  attempt("the holder of an optional field is frozen, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
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
  Object.seal(o);
  attempt("the holder of an optional field is sealed, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
  attempt("the holder of an optional field is sealed, asked by a typed function", () => ask2(o));
  attempt("the holder of an optional field is sealed, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "string").length);
  attempt("the holder of an optional field is sealed, used", () => o.value?.length);
  attempt("the holder of an optional field is sealed, or a default", () => o.value ?? "default");
  attempt("the holder of an optional field is sealed, listed", () => ("value" in o) + " " + Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of an optional field is sealed, a typed store", () => (o.value = "t"));
  attempt("the holder of an optional field is sealed, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
}

block2();

class C3 {
  id = 1;
  value?: string = "s";
}

function ask3(o: C3): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value;
}

function block3(): void {
  const o = new C3();
  Reflect.preventExtensions(o);
  attempt("the holder of an optional field is kept from growing, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
  attempt("the holder of an optional field is kept from growing, asked by a typed function", () => ask3(o));
  attempt("the holder of an optional field is kept from growing, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "string").length);
  attempt("the holder of an optional field is kept from growing, used", () => o.value?.length);
  attempt("the holder of an optional field is kept from growing, or a default", () => o.value ?? "default");
  attempt("the holder of an optional field is kept from growing, listed", () => ("value" in o) + " " + Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of an optional field is kept from growing, a typed store", () => (o.value = "t"));
  attempt("the holder of an optional field is kept from growing, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
}

block3();

class C4 {
  id = 1;
  value?: string = "s";
}

function ask4(o: C4): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value;
}

function block4(): void {
  const o = new C4();
  Object.defineProperty(o, "value", { writable: false });
  attempt("an optional field is made read-only, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
  attempt("an optional field is made read-only, asked by a typed function", () => ask4(o));
  attempt("an optional field is made read-only, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "string").length);
  attempt("an optional field is made read-only, used", () => o.value?.length);
  attempt("an optional field is made read-only, or a default", () => o.value ?? "default");
  attempt("an optional field is made read-only, listed", () => ("value" in o) + " " + Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("an optional field is made read-only, a typed store", () => (o.value = "t"));
  attempt("an optional field is made read-only, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
}

block4();

class C5 {
  readonly value: number = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask5(o: C5): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block5(): void {
  const o = new C5();
  Object.freeze(o);
  attempt("the holder of a readonly field is frozen, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("the holder of a readonly field is frozen, asked by a typed function", () => ask5(o));
  attempt("the holder of a readonly field is frozen, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("the holder of a readonly field is frozen, used", () => o.value + 1);
  attempt("the holder of a readonly field is frozen, by its own method", () => o.twice());
  attempt("the holder of a readonly field is frozen, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
}

block5();

class C6 {
  readonly value: number = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask6(o: C6): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block6(): void {
  const o = new C6();
  Object.seal(o);
  attempt("the holder of a readonly field is sealed, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("the holder of a readonly field is sealed, asked by a typed function", () => ask6(o));
  attempt("the holder of a readonly field is sealed, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("the holder of a readonly field is sealed, used", () => o.value + 1);
  attempt("the holder of a readonly field is sealed, by its own method", () => o.twice());
  attempt("the holder of a readonly field is sealed, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
}

block6();

class C7 {
  readonly value: number = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask7(o: C7): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block7(): void {
  const o = new C7();
  Reflect.preventExtensions(o);
  attempt("the holder of a readonly field is kept from growing, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("the holder of a readonly field is kept from growing, asked by a typed function", () => ask7(o));
  attempt("the holder of a readonly field is kept from growing, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("the holder of a readonly field is kept from growing, used", () => o.value + 1);
  attempt("the holder of a readonly field is kept from growing, by its own method", () => o.twice());
  attempt("the holder of a readonly field is kept from growing, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
}

block7();

class C8 {
  readonly value: number = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask8(o: C8): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block8(): void {
  const o = new C8();
  Object.defineProperty(o, "value", { writable: false });
  attempt("a readonly field is made read-only, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("a readonly field is made read-only, asked by a typed function", () => ask8(o));
  attempt("a readonly field is made read-only, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("a readonly field is made read-only, used", () => o.value + 1);
  attempt("a readonly field is made read-only, by its own method", () => o.twice());
  attempt("a readonly field is made read-only, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
}

block8();

export {};

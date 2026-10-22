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
  Object.freeze(o);
  attempt("the holder of a number field is frozen, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("the holder of a number field is frozen, asked by a typed function", () => ask1(o));
  attempt("the holder of a number field is frozen, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("the holder of a number field is frozen, used", () => o.value + 1);
  attempt("the holder of a number field is frozen, by its own method", () => o.twice());
  attempt("the holder of a number field is frozen, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of a number field is frozen, a typed store", () => (o.value = 5));
  attempt("the holder of a number field is frozen, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
}

block1();

class C2 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask2(o: C2): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block2(): void {
  const o = new C2();
  Object.seal(o);
  attempt("the holder of a number field is sealed, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("the holder of a number field is sealed, asked by a typed function", () => ask2(o));
  attempt("the holder of a number field is sealed, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("the holder of a number field is sealed, used", () => o.value + 1);
  attempt("the holder of a number field is sealed, by its own method", () => o.twice());
  attempt("the holder of a number field is sealed, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of a number field is sealed, a typed store", () => (o.value = 5));
  attempt("the holder of a number field is sealed, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
}

block2();

class C3 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask3(o: C3): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block3(): void {
  const o = new C3();
  Reflect.preventExtensions(o);
  attempt("the holder of a number field is kept from growing, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("the holder of a number field is kept from growing, asked by a typed function", () => ask3(o));
  attempt("the holder of a number field is kept from growing, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("the holder of a number field is kept from growing, used", () => o.value + 1);
  attempt("the holder of a number field is kept from growing, by its own method", () => o.twice());
  attempt("the holder of a number field is kept from growing, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of a number field is kept from growing, a typed store", () => (o.value = 5));
  attempt("the holder of a number field is kept from growing, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
}

block3();

class C4 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask4(o: C4): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block4(): void {
  const o = new C4();
  Object.defineProperty(o, "value", { writable: false });
  attempt("a number field is made read-only, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("a number field is made read-only, asked by a typed function", () => ask4(o));
  attempt("a number field is made read-only, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("a number field is made read-only, used", () => o.value + 1);
  attempt("a number field is made read-only, by its own method", () => o.twice());
  attempt("a number field is made read-only, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a number field is made read-only, a typed store", () => (o.value = 5));
  attempt("a number field is made read-only, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
}

block4();

class C5 {
  value = "s";
  size(): number {
    return this.value.length;
  }
}

function ask5(o: C5): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value;
}

function block5(): void {
  const o = new C5();
  Object.freeze(o);
  attempt("the holder of a string field is frozen, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
  attempt("the holder of a string field is frozen, asked by a typed function", () => ask5(o));
  attempt("the holder of a string field is frozen, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "string").length);
  attempt("the holder of a string field is frozen, used", () => o.value.length);
  attempt("the holder of a string field is frozen, by its own method", () => o.size());
  attempt("the holder of a string field is frozen, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of a string field is frozen, a typed store", () => (o.value = "t"));
  attempt("the holder of a string field is frozen, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
}

block5();

class C6 {
  value = "s";
  size(): number {
    return this.value.length;
  }
}

function ask6(o: C6): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value;
}

function block6(): void {
  const o = new C6();
  Object.seal(o);
  attempt("the holder of a string field is sealed, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
  attempt("the holder of a string field is sealed, asked by a typed function", () => ask6(o));
  attempt("the holder of a string field is sealed, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "string").length);
  attempt("the holder of a string field is sealed, used", () => o.value.length);
  attempt("the holder of a string field is sealed, by its own method", () => o.size());
  attempt("the holder of a string field is sealed, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of a string field is sealed, a typed store", () => (o.value = "t"));
  attempt("the holder of a string field is sealed, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
}

block6();

class C7 {
  value = "s";
  size(): number {
    return this.value.length;
  }
}

function ask7(o: C7): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value;
}

function block7(): void {
  const o = new C7();
  Reflect.preventExtensions(o);
  attempt("the holder of a string field is kept from growing, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
  attempt("the holder of a string field is kept from growing, asked by a typed function", () => ask7(o));
  attempt("the holder of a string field is kept from growing, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "string").length);
  attempt("the holder of a string field is kept from growing, used", () => o.value.length);
  attempt("the holder of a string field is kept from growing, by its own method", () => o.size());
  attempt("the holder of a string field is kept from growing, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of a string field is kept from growing, a typed store", () => (o.value = "t"));
  attempt("the holder of a string field is kept from growing, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
}

block7();

class C8 {
  value = "s";
  size(): number {
    return this.value.length;
  }
}

function ask8(o: C8): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value;
}

function block8(): void {
  const o = new C8();
  Object.defineProperty(o, "value", { writable: false });
  attempt("a string field is made read-only, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
  attempt("a string field is made read-only, asked by a typed function", () => ask8(o));
  attempt("a string field is made read-only, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "string").length);
  attempt("a string field is made read-only, used", () => o.value.length);
  attempt("a string field is made read-only, by its own method", () => o.size());
  attempt("a string field is made read-only, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a string field is made read-only, a typed store", () => (o.value = "t"));
  attempt("a string field is made read-only, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
}

block8();

class C9 {
  value = true;
  word(): string {
    return this.value ? "yes" : "no";
  }
}

function ask9(o: C9): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value;
}

function block9(): void {
  const o = new C9();
  Object.freeze(o);
  attempt("the holder of a boolean field is frozen, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value);
  attempt("the holder of a boolean field is frozen, asked by a typed function", () => ask9(o));
  attempt("the holder of a boolean field is frozen, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "boolean").length);
  attempt("the holder of a boolean field is frozen, used", () => o.value ? "truthy" : "falsy");
  attempt("the holder of a boolean field is frozen, by its own method", () => o.word());
  attempt("the holder of a boolean field is frozen, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of a boolean field is frozen, a typed store", () => (o.value = false));
  attempt("the holder of a boolean field is frozen, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value);
}

block9();

class C10 {
  value = true;
  word(): string {
    return this.value ? "yes" : "no";
  }
}

function ask10(o: C10): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value;
}

function block10(): void {
  const o = new C10();
  Object.seal(o);
  attempt("the holder of a boolean field is sealed, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value);
  attempt("the holder of a boolean field is sealed, asked by a typed function", () => ask10(o));
  attempt("the holder of a boolean field is sealed, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "boolean").length);
  attempt("the holder of a boolean field is sealed, used", () => o.value ? "truthy" : "falsy");
  attempt("the holder of a boolean field is sealed, by its own method", () => o.word());
  attempt("the holder of a boolean field is sealed, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of a boolean field is sealed, a typed store", () => (o.value = false));
  attempt("the holder of a boolean field is sealed, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value);
}

block10();

class C11 {
  value = true;
  word(): string {
    return this.value ? "yes" : "no";
  }
}

function ask11(o: C11): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value;
}

function block11(): void {
  const o = new C11();
  Reflect.preventExtensions(o);
  attempt("the holder of a boolean field is kept from growing, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value);
  attempt("the holder of a boolean field is kept from growing, asked by a typed function", () => ask11(o));
  attempt("the holder of a boolean field is kept from growing, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "boolean").length);
  attempt("the holder of a boolean field is kept from growing, used", () => o.value ? "truthy" : "falsy");
  attempt("the holder of a boolean field is kept from growing, by its own method", () => o.word());
  attempt("the holder of a boolean field is kept from growing, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of a boolean field is kept from growing, a typed store", () => (o.value = false));
  attempt("the holder of a boolean field is kept from growing, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value);
}

block11();

class C12 {
  value = true;
  word(): string {
    return this.value ? "yes" : "no";
  }
}

function ask12(o: C12): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value;
}

function block12(): void {
  const o = new C12();
  Object.defineProperty(o, "value", { writable: false });
  attempt("a boolean field is made read-only, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value);
  attempt("a boolean field is made read-only, asked by a typed function", () => ask12(o));
  attempt("a boolean field is made read-only, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "boolean").length);
  attempt("a boolean field is made read-only, used", () => o.value ? "truthy" : "falsy");
  attempt("a boolean field is made read-only, by its own method", () => o.word());
  attempt("a boolean field is made read-only, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a boolean field is made read-only, a typed store", () => (o.value = false));
  attempt("a boolean field is made read-only, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value);
}

block12();

export {};

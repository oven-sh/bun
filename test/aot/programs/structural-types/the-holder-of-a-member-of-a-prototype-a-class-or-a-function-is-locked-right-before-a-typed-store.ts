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
  Object.freeze(C1.prototype);
  attempt("the holder of a method of a prototype is frozen, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
  attempt("the holder of a method of a prototype is frozen, asked by a typed function", () => ask1(o));
  attempt("the holder of a method of a prototype is frozen, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("the holder of a method of a prototype is frozen, used", () => o.value());
  attempt("the holder of a method of a prototype is frozen, on a new instance", () => new C1().value());
  attempt("the holder of a method of a prototype is frozen, listed", () => Object.hasOwn(o, "value") + " " + Object.getOwnPropertyNames(C1.prototype).join());
  attempt("the holder of a method of a prototype is frozen, a typed store", () => (o.value = () => 2));
  attempt("the holder of a method of a prototype is frozen, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
}

block1();

class C2 {
  level = 1;
  value(): number {
    return this.level;
  }
}

function ask2(o: C2): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value;
}

function block2(): void {
  const o = new C2();
  Object.seal(C2.prototype);
  attempt("the holder of a method of a prototype is sealed, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
  attempt("the holder of a method of a prototype is sealed, asked by a typed function", () => ask2(o));
  attempt("the holder of a method of a prototype is sealed, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("the holder of a method of a prototype is sealed, used", () => o.value());
  attempt("the holder of a method of a prototype is sealed, on a new instance", () => new C2().value());
  attempt("the holder of a method of a prototype is sealed, listed", () => Object.hasOwn(o, "value") + " " + Object.getOwnPropertyNames(C2.prototype).join());
  attempt("the holder of a method of a prototype is sealed, a typed store", () => (o.value = () => 2));
  attempt("the holder of a method of a prototype is sealed, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
}

block2();

class C3 {
  level = 1;
  value(): number {
    return this.level;
  }
}

function ask3(o: C3): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value;
}

function block3(): void {
  const o = new C3();
  Reflect.preventExtensions(C3.prototype);
  attempt("the holder of a method of a prototype is kept from growing, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
  attempt("the holder of a method of a prototype is kept from growing, asked by a typed function", () => ask3(o));
  attempt("the holder of a method of a prototype is kept from growing, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("the holder of a method of a prototype is kept from growing, used", () => o.value());
  attempt("the holder of a method of a prototype is kept from growing, on a new instance", () => new C3().value());
  attempt("the holder of a method of a prototype is kept from growing, listed", () => Object.hasOwn(o, "value") + " " + Object.getOwnPropertyNames(C3.prototype).join());
  attempt("the holder of a method of a prototype is kept from growing, a typed store", () => (o.value = () => 2));
  attempt("the holder of a method of a prototype is kept from growing, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
}

block3();

class C4 {
  level = 1;
  value(): number {
    return this.level;
  }
}

function ask4(o: C4): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value;
}

function block4(): void {
  const o = new C4();
  Object.defineProperty(C4.prototype, "value", { writable: false });
  attempt("a method of a prototype is made read-only, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
  attempt("a method of a prototype is made read-only, asked by a typed function", () => ask4(o));
  attempt("a method of a prototype is made read-only, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("a method of a prototype is made read-only, used", () => o.value());
  attempt("a method of a prototype is made read-only, on a new instance", () => new C4().value());
  attempt("a method of a prototype is made read-only, listed", () => Object.hasOwn(o, "value") + " " + Object.getOwnPropertyNames(C4.prototype).join());
  attempt("a method of a prototype is made read-only, a typed store", () => (o.value = () => 2));
  attempt("a method of a prototype is made read-only, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
}

block4();

class C5 {
  static value = 1;
  static twice(): number {
    return C5.value * 2;
  }
}

function ask5(o: typeof C5): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block5(): void {
  Object.freeze(C5);
  attempt("the holder of a static field is frozen, asked directly", () => (C5.value === undefined) + " " + (C5.value == null) + " " + (typeof C5.value === "number") + " " + typeof C5.value);
  attempt("the holder of a static field is frozen, asked by a typed function", () => ask5(C5));
  attempt("the holder of a static field is frozen, asked by a callback", () => [C5].filter(q => q.value === undefined).length + " " + [C5].filter(q => typeof q.value === "number").length);
  attempt("the holder of a static field is frozen, used", () => C5.value + 1);
  attempt("the holder of a static field is frozen, by a static method", () => C5.twice());
  attempt("the holder of a static field is frozen, listed", () => Object.keys(C5).join());
  attempt("the holder of a static field is frozen, a typed store", () => (C5.value = 5));
  attempt("the holder of a static field is frozen, asked after the store", () => (C5.value === undefined) + " " + (C5.value == null) + " " + (typeof C5.value === "number") + " " + typeof C5.value);
}

block5();

class C6 {
  static value = 1;
  static twice(): number {
    return C6.value * 2;
  }
}

function ask6(o: typeof C6): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block6(): void {
  Object.seal(C6);
  attempt("the holder of a static field is sealed, asked directly", () => (C6.value === undefined) + " " + (C6.value == null) + " " + (typeof C6.value === "number") + " " + typeof C6.value);
  attempt("the holder of a static field is sealed, asked by a typed function", () => ask6(C6));
  attempt("the holder of a static field is sealed, asked by a callback", () => [C6].filter(q => q.value === undefined).length + " " + [C6].filter(q => typeof q.value === "number").length);
  attempt("the holder of a static field is sealed, used", () => C6.value + 1);
  attempt("the holder of a static field is sealed, by a static method", () => C6.twice());
  attempt("the holder of a static field is sealed, listed", () => Object.keys(C6).join());
  attempt("the holder of a static field is sealed, a typed store", () => (C6.value = 5));
  attempt("the holder of a static field is sealed, asked after the store", () => (C6.value === undefined) + " " + (C6.value == null) + " " + (typeof C6.value === "number") + " " + typeof C6.value);
}

block6();

class C7 {
  static value = 1;
  static twice(): number {
    return C7.value * 2;
  }
}

function ask7(o: typeof C7): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block7(): void {
  Reflect.preventExtensions(C7);
  attempt("the holder of a static field is kept from growing, asked directly", () => (C7.value === undefined) + " " + (C7.value == null) + " " + (typeof C7.value === "number") + " " + typeof C7.value);
  attempt("the holder of a static field is kept from growing, asked by a typed function", () => ask7(C7));
  attempt("the holder of a static field is kept from growing, asked by a callback", () => [C7].filter(q => q.value === undefined).length + " " + [C7].filter(q => typeof q.value === "number").length);
  attempt("the holder of a static field is kept from growing, used", () => C7.value + 1);
  attempt("the holder of a static field is kept from growing, by a static method", () => C7.twice());
  attempt("the holder of a static field is kept from growing, listed", () => Object.keys(C7).join());
  attempt("the holder of a static field is kept from growing, a typed store", () => (C7.value = 5));
  attempt("the holder of a static field is kept from growing, asked after the store", () => (C7.value === undefined) + " " + (C7.value == null) + " " + (typeof C7.value === "number") + " " + typeof C7.value);
}

block7();

class C8 {
  static value = 1;
  static twice(): number {
    return C8.value * 2;
  }
}

function ask8(o: typeof C8): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block8(): void {
  Object.defineProperty(C8, "value", { writable: false });
  attempt("a static field is made read-only, asked directly", () => (C8.value === undefined) + " " + (C8.value == null) + " " + (typeof C8.value === "number") + " " + typeof C8.value);
  attempt("a static field is made read-only, asked by a typed function", () => ask8(C8));
  attempt("a static field is made read-only, asked by a callback", () => [C8].filter(q => q.value === undefined).length + " " + [C8].filter(q => typeof q.value === "number").length);
  attempt("a static field is made read-only, used", () => C8.value + 1);
  attempt("a static field is made read-only, by a static method", () => C8.twice());
  attempt("a static field is made read-only, listed", () => Object.keys(C8).join());
  attempt("a static field is made read-only, a typed store", () => (C8.value = 5));
  attempt("a static field is made read-only, asked after the store", () => (C8.value === undefined) + " " + (C8.value == null) + " " + (typeof C8.value === "number") + " " + typeof C8.value);
}

block8();

function ask9(o: { value: number }): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block9(): void {
  const f = Object.assign((n: number): number => n * 2, { value: 1 });
  Object.freeze(f);
  attempt("the holder of a member of a function is frozen, asked directly", () => (f.value === undefined) + " " + (f.value == null) + " " + (typeof f.value === "number") + " " + typeof f.value);
  attempt("the holder of a member of a function is frozen, asked by a typed function", () => ask9(f));
  attempt("the holder of a member of a function is frozen, asked by a callback", () => [f].filter(q => q.value === undefined).length + " " + [f].filter(q => typeof q.value === "number").length);
  attempt("the holder of a member of a function is frozen, used", () => f.value + 1);
  attempt("the holder of a member of a function is frozen, called", () => f(2));
  attempt("the holder of a member of a function is frozen, listed", () => Object.keys(f).join());
  attempt("the holder of a member of a function is frozen, a typed store", () => (f.value = 5));
  attempt("the holder of a member of a function is frozen, asked after the store", () => (f.value === undefined) + " " + (f.value == null) + " " + (typeof f.value === "number") + " " + typeof f.value);
}

block9();

function ask10(o: { value: number }): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block10(): void {
  const f = Object.assign((n: number): number => n * 2, { value: 1 });
  Object.seal(f);
  attempt("the holder of a member of a function is sealed, asked directly", () => (f.value === undefined) + " " + (f.value == null) + " " + (typeof f.value === "number") + " " + typeof f.value);
  attempt("the holder of a member of a function is sealed, asked by a typed function", () => ask10(f));
  attempt("the holder of a member of a function is sealed, asked by a callback", () => [f].filter(q => q.value === undefined).length + " " + [f].filter(q => typeof q.value === "number").length);
  attempt("the holder of a member of a function is sealed, used", () => f.value + 1);
  attempt("the holder of a member of a function is sealed, called", () => f(2));
  attempt("the holder of a member of a function is sealed, listed", () => Object.keys(f).join());
  attempt("the holder of a member of a function is sealed, a typed store", () => (f.value = 5));
  attempt("the holder of a member of a function is sealed, asked after the store", () => (f.value === undefined) + " " + (f.value == null) + " " + (typeof f.value === "number") + " " + typeof f.value);
}

block10();

function ask11(o: { value: number }): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block11(): void {
  const f = Object.assign((n: number): number => n * 2, { value: 1 });
  Reflect.preventExtensions(f);
  attempt("the holder of a member of a function is kept from growing, asked directly", () => (f.value === undefined) + " " + (f.value == null) + " " + (typeof f.value === "number") + " " + typeof f.value);
  attempt("the holder of a member of a function is kept from growing, asked by a typed function", () => ask11(f));
  attempt("the holder of a member of a function is kept from growing, asked by a callback", () => [f].filter(q => q.value === undefined).length + " " + [f].filter(q => typeof q.value === "number").length);
  attempt("the holder of a member of a function is kept from growing, used", () => f.value + 1);
  attempt("the holder of a member of a function is kept from growing, called", () => f(2));
  attempt("the holder of a member of a function is kept from growing, listed", () => Object.keys(f).join());
  attempt("the holder of a member of a function is kept from growing, a typed store", () => (f.value = 5));
  attempt("the holder of a member of a function is kept from growing, asked after the store", () => (f.value === undefined) + " " + (f.value == null) + " " + (typeof f.value === "number") + " " + typeof f.value);
}

block11();

function ask12(o: { value: number }): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block12(): void {
  const f = Object.assign((n: number): number => n * 2, { value: 1 });
  Object.defineProperty(f, "value", { writable: false });
  attempt("a member of a function is made read-only, asked directly", () => (f.value === undefined) + " " + (f.value == null) + " " + (typeof f.value === "number") + " " + typeof f.value);
  attempt("a member of a function is made read-only, asked by a typed function", () => ask12(f));
  attempt("a member of a function is made read-only, asked by a callback", () => [f].filter(q => q.value === undefined).length + " " + [f].filter(q => typeof q.value === "number").length);
  attempt("a member of a function is made read-only, used", () => f.value + 1);
  attempt("a member of a function is made read-only, called", () => f(2));
  attempt("a member of a function is made read-only, listed", () => Object.keys(f).join());
  attempt("a member of a function is made read-only, a typed store", () => (f.value = 5));
  attempt("a member of a function is made read-only, asked after the store", () => (f.value === undefined) + " " + (f.value == null) + " " + (typeof f.value === "number") + " " + typeof f.value);
}

block12();

export {};

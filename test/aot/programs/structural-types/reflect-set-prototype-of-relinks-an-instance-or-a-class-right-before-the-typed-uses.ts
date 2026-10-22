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

class D1 {
  level = 2;
  value(): number {
    return -1;
  }
}

function ask1(o: C1): string {
  return (o instanceof C1) + " " + (typeof o.value === "function") + " " + ("value" in o);
}

function block1(): void {
  const o = new C1();
  Reflect.setPrototypeOf(o, D1.prototype);
  attempt("an instance is relinked to the prototype of another class, asked directly", () => (o instanceof C1) + " " + (typeof o.value === "function") + " " + ("value" in o));
  attempt("an instance is relinked to the prototype of another class, asked by a typed function", () => ask1(o));
  attempt("an instance is relinked to the prototype of another class, asked by a callback", () => [o].filter(q => q instanceof C1).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("an instance is relinked to the prototype of another class, its method", () => o.value());
  attempt("an instance is relinked to the prototype of another class, its field", () => o.level);
  attempt("an instance is relinked to the prototype of another class, another instance", () => new C1().value() + " " + (new C1() instanceof C1));
}

block1();

class C2 {
  level = 1;
  value(): number {
    return this.level;
  }
}

class D2 {
  level = 2;
  value(): number {
    return -1;
  }
}

function ask2(o: C2): string {
  return (o instanceof C2) + " " + (typeof o.value === "function") + " " + ("value" in o);
}

function block2(): void {
  const o = new C2();
  Reflect.setPrototypeOf(o, null);
  attempt("an instance is relinked to null, asked directly", () => (o instanceof C2) + " " + (typeof o.value === "function") + " " + ("value" in o));
  attempt("an instance is relinked to null, asked by a typed function", () => ask2(o));
  attempt("an instance is relinked to null, asked by a callback", () => [o].filter(q => q instanceof C2).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("an instance is relinked to null, its method", () => o.value());
  attempt("an instance is relinked to null, its field", () => o.level);
  attempt("an instance is relinked to null, another instance", () => new C2().value() + " " + (new C2() instanceof C2));
}

block2();

class C3 {
  level = 1;
  value(): number {
    return this.level;
  }
}

class D3 {
  level = 2;
  value(): number {
    return -1;
  }
}

function ask3(o: C3): string {
  return (o instanceof C3) + " " + (typeof o.value === "function") + " " + ("value" in o);
}

function block3(): void {
  const o = new C3();
  Reflect.setPrototypeOf(o, { value: () => -2 });
  attempt("an instance is relinked to a plain object, asked directly", () => (o instanceof C3) + " " + (typeof o.value === "function") + " " + ("value" in o));
  attempt("an instance is relinked to a plain object, asked by a typed function", () => ask3(o));
  attempt("an instance is relinked to a plain object, asked by a callback", () => [o].filter(q => q instanceof C3).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("an instance is relinked to a plain object, its method", () => o.value());
  attempt("an instance is relinked to a plain object, its field", () => o.level);
  attempt("an instance is relinked to a plain object, another instance", () => new C3().value() + " " + (new C3() instanceof C3));
}

block3();

class C4 {
  level = 1;
  value(): number {
    return this.level;
  }
}

class D4 {
  level = 2;
  value(): number {
    return -1;
  }
}

function ask4(o: C4): string {
  return (o instanceof C4) + " " + (typeof o.value === "function") + " " + ("value" in o);
}

function block4(): void {
  const o = new C4();
  Reflect.setPrototypeOf(o, Object.create(C4.prototype));
  attempt("an instance is relinked to a child of its own prototype, asked directly", () => (o instanceof C4) + " " + (typeof o.value === "function") + " " + ("value" in o));
  attempt("an instance is relinked to a child of its own prototype, asked by a typed function", () => ask4(o));
  attempt("an instance is relinked to a child of its own prototype, asked by a callback", () => [o].filter(q => q instanceof C4).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("an instance is relinked to a child of its own prototype, its method", () => o.value());
  attempt("an instance is relinked to a child of its own prototype, its field", () => o.level);
  attempt("an instance is relinked to a child of its own prototype, another instance", () => new C4().value() + " " + (new C4() instanceof C4));
}

block4();

class B5 {
  level = 1;
  value(): number {
    return this.level;
  }
  static kind = "base";
}

class C5 extends B5 {
  extra = 3;
}

class D5 {
  level = 2;
  value(): number {
    return -1;
  }
  static kind = "other";
}

function ask5(o: B5): string {
  return (o instanceof B5) + " " + (typeof o.value === "function") + " " + ("value" in o);
}

function block5(): void {
  const o = new C5();
  Reflect.setPrototypeOf(C5.prototype, D5.prototype);
  attempt("the prototype of a subclass is relinked to the prototype of another class, asked directly", () => (o instanceof B5) + " " + (typeof o.value === "function") + " " + ("value" in o));
  attempt("the prototype of a subclass is relinked to the prototype of another class, asked by a typed function", () => ask5(o));
  attempt("the prototype of a subclass is relinked to the prototype of another class, asked by a callback", () => [o].filter(q => q instanceof B5).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("the prototype of a subclass is relinked to the prototype of another class, its method", () => o.value());
  attempt("the prototype of a subclass is relinked to the prototype of another class, its fields", () => o.level + o.extra);
  attempt("the prototype of a subclass is relinked to the prototype of another class, still of its own class", () => o instanceof C5);
  attempt("the prototype of a subclass is relinked to the prototype of another class, an instance of the base", () => new B5().value());
}

block5();

class B6 {
  level = 1;
  value(): number {
    return this.level;
  }
  static kind = "base";
}

class C6 extends B6 {
  extra = 3;
}

class D6 {
  level = 2;
  value(): number {
    return -1;
  }
  static kind = "other";
}

function ask6(o: B6): string {
  return (o instanceof B6) + " " + (typeof o.value === "function") + " " + ("value" in o);
}

function block6(): void {
  const o = new C6();
  Reflect.setPrototypeOf(C6.prototype, null);
  attempt("the prototype of a subclass is relinked to null, asked directly", () => (o instanceof B6) + " " + (typeof o.value === "function") + " " + ("value" in o));
  attempt("the prototype of a subclass is relinked to null, asked by a typed function", () => ask6(o));
  attempt("the prototype of a subclass is relinked to null, asked by a callback", () => [o].filter(q => q instanceof B6).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("the prototype of a subclass is relinked to null, its method", () => o.value());
  attempt("the prototype of a subclass is relinked to null, its fields", () => o.level + o.extra);
  attempt("the prototype of a subclass is relinked to null, still of its own class", () => o instanceof C6);
  attempt("the prototype of a subclass is relinked to null, an instance of the base", () => new B6().value());
}

block6();

class B7 {
  level = 1;
  value(): number {
    return this.level;
  }
  static kind = "base";
}

class C7 extends B7 {
  extra = 3;
}

class D7 {
  level = 2;
  value(): number {
    return -1;
  }
  static kind = "other";
}

function ask7(o: typeof B7): string {
  return (typeof o.kind === "string") + " " + ("kind" in o) + " " + o.kind;
}

function block7(): void {
  Reflect.setPrototypeOf(C7, D7);
  attempt("a subclass is relinked to another class, asked directly", () => (typeof C7.kind === "string") + " " + ("kind" in C7) + " " + C7.kind);
  attempt("a subclass is relinked to another class, asked by a typed function", () => ask7(C7));
  attempt("a subclass is relinked to another class, asked by a callback", () => [C7].filter(q => typeof q.kind === "string").length);
  attempt("a subclass is relinked to another class, the base keeps its own", () => B7.kind);
  attempt("a subclass is relinked to another class, what it inherits from", () => Object.getPrototypeOf(C7) === B7);
}

block7();

class B8 {
  level = 1;
  value(): number {
    return this.level;
  }
  static kind = "base";
}

class C8 extends B8 {
  extra = 3;
}

class D8 {
  level = 2;
  value(): number {
    return -1;
  }
  static kind = "other";
}

function ask8(o: typeof B8): string {
  return (typeof o.kind === "string") + " " + ("kind" in o) + " " + o.kind;
}

function block8(): void {
  Reflect.setPrototypeOf(C8, Function.prototype);
  attempt("a subclass is relinked to Function.prototype, asked directly", () => (typeof C8.kind === "string") + " " + ("kind" in C8) + " " + C8.kind);
  attempt("a subclass is relinked to Function.prototype, asked by a typed function", () => ask8(C8));
  attempt("a subclass is relinked to Function.prototype, asked by a callback", () => [C8].filter(q => typeof q.kind === "string").length);
  attempt("a subclass is relinked to Function.prototype, the base keeps its own", () => B8.kind);
  attempt("a subclass is relinked to Function.prototype, what it inherits from", () => Object.getPrototypeOf(C8) === B8);
}

block8();

export {};

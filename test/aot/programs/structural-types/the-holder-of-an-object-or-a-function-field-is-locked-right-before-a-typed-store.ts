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
  value = { depth: 1 };
  depth(): number {
    return this.value.depth;
  }
}

function ask1(o: C1): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value;
}

function block1(): void {
  const o = new C1();
  Object.freeze(o);
  attempt("the holder of an object field is frozen, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value);
  attempt("the holder of an object field is frozen, asked by a typed function", () => ask1(o));
  attempt("the holder of an object field is frozen, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "object").length);
  attempt("the holder of an object field is frozen, used", () => o.value.depth);
  attempt("the holder of an object field is frozen, by its own method", () => o.depth());
  attempt("the holder of an object field is frozen, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of an object field is frozen, a typed store", () => (o.value = { depth: 2 }));
  attempt("the holder of an object field is frozen, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value);
}

block1();

class C2 {
  value = { depth: 1 };
  depth(): number {
    return this.value.depth;
  }
}

function ask2(o: C2): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value;
}

function block2(): void {
  const o = new C2();
  Object.seal(o);
  attempt("the holder of an object field is sealed, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value);
  attempt("the holder of an object field is sealed, asked by a typed function", () => ask2(o));
  attempt("the holder of an object field is sealed, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "object").length);
  attempt("the holder of an object field is sealed, used", () => o.value.depth);
  attempt("the holder of an object field is sealed, by its own method", () => o.depth());
  attempt("the holder of an object field is sealed, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of an object field is sealed, a typed store", () => (o.value = { depth: 2 }));
  attempt("the holder of an object field is sealed, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value);
}

block2();

class C3 {
  value = { depth: 1 };
  depth(): number {
    return this.value.depth;
  }
}

function ask3(o: C3): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value;
}

function block3(): void {
  const o = new C3();
  Reflect.preventExtensions(o);
  attempt("the holder of an object field is kept from growing, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value);
  attempt("the holder of an object field is kept from growing, asked by a typed function", () => ask3(o));
  attempt("the holder of an object field is kept from growing, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "object").length);
  attempt("the holder of an object field is kept from growing, used", () => o.value.depth);
  attempt("the holder of an object field is kept from growing, by its own method", () => o.depth());
  attempt("the holder of an object field is kept from growing, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of an object field is kept from growing, a typed store", () => (o.value = { depth: 2 }));
  attempt("the holder of an object field is kept from growing, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value);
}

block3();

class C4 {
  value = { depth: 1 };
  depth(): number {
    return this.value.depth;
  }
}

function ask4(o: C4): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value;
}

function block4(): void {
  const o = new C4();
  Object.defineProperty(o, "value", { writable: false });
  attempt("an object field is made read-only, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value);
  attempt("an object field is made read-only, asked by a typed function", () => ask4(o));
  attempt("an object field is made read-only, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "object").length);
  attempt("an object field is made read-only, used", () => o.value.depth);
  attempt("an object field is made read-only, by its own method", () => o.depth());
  attempt("an object field is made read-only, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("an object field is made read-only, a typed store", () => (o.value = { depth: 2 }));
  attempt("an object field is made read-only, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value);
}

block4();

class C5 {
  value: () => number = () => 1;
  run(): number {
    return this.value();
  }
}

function ask5(o: C5): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value;
}

function block5(): void {
  const o = new C5();
  Object.freeze(o);
  attempt("the holder of a function field is frozen, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
  attempt("the holder of a function field is frozen, asked by a typed function", () => ask5(o));
  attempt("the holder of a function field is frozen, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("the holder of a function field is frozen, used", () => o.value());
  attempt("the holder of a function field is frozen, by its own method", () => o.run());
  attempt("the holder of a function field is frozen, listed", () => Object.keys(o).join());
  attempt("the holder of a function field is frozen, a typed store", () => (o.value = () => 2));
  attempt("the holder of a function field is frozen, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
}

block5();

class C6 {
  value: () => number = () => 1;
  run(): number {
    return this.value();
  }
}

function ask6(o: C6): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value;
}

function block6(): void {
  const o = new C6();
  Object.seal(o);
  attempt("the holder of a function field is sealed, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
  attempt("the holder of a function field is sealed, asked by a typed function", () => ask6(o));
  attempt("the holder of a function field is sealed, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("the holder of a function field is sealed, used", () => o.value());
  attempt("the holder of a function field is sealed, by its own method", () => o.run());
  attempt("the holder of a function field is sealed, listed", () => Object.keys(o).join());
  attempt("the holder of a function field is sealed, a typed store", () => (o.value = () => 2));
  attempt("the holder of a function field is sealed, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
}

block6();

class C7 {
  value: () => number = () => 1;
  run(): number {
    return this.value();
  }
}

function ask7(o: C7): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value;
}

function block7(): void {
  const o = new C7();
  Reflect.preventExtensions(o);
  attempt("the holder of a function field is kept from growing, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
  attempt("the holder of a function field is kept from growing, asked by a typed function", () => ask7(o));
  attempt("the holder of a function field is kept from growing, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("the holder of a function field is kept from growing, used", () => o.value());
  attempt("the holder of a function field is kept from growing, by its own method", () => o.run());
  attempt("the holder of a function field is kept from growing, listed", () => Object.keys(o).join());
  attempt("the holder of a function field is kept from growing, a typed store", () => (o.value = () => 2));
  attempt("the holder of a function field is kept from growing, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
}

block7();

class C8 {
  value: () => number = () => 1;
  run(): number {
    return this.value();
  }
}

function ask8(o: C8): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value;
}

function block8(): void {
  const o = new C8();
  Object.defineProperty(o, "value", { writable: false });
  attempt("a function field is made read-only, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
  attempt("a function field is made read-only, asked by a typed function", () => ask8(o));
  attempt("a function field is made read-only, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("a function field is made read-only, used", () => o.value());
  attempt("a function field is made read-only, by its own method", () => o.run());
  attempt("a function field is made read-only, listed", () => Object.keys(o).join());
  attempt("a function field is made read-only, a typed store", () => (o.value = () => 2));
  attempt("a function field is made read-only, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
}

block8();

export {};

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
  Object.freeze(o);
  attempt("the holder of a member of a literal is frozen, asked directly", () => (o.value1 === undefined) + " " + (o.value1 == null) + " " + (typeof o.value1 === "number") + " " + typeof o.value1);
  attempt("the holder of a member of a literal is frozen, asked by a typed function", () => ask1(o));
  attempt("the holder of a member of a literal is frozen, asked by a callback", () => [o].filter(q => q.value1 === undefined).length + " " + [o].filter(q => typeof q.value1 === "number").length);
  attempt("the holder of a member of a literal is frozen, used", () => o.value1 + o.other1);
  attempt("the holder of a member of a literal is frozen, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of a member of a literal is frozen, copied", () => JSON.stringify({ ...o }));
  attempt("the holder of a member of a literal is frozen, a typed store", () => (o.value1 = 5));
  attempt("the holder of a member of a literal is frozen, asked after the store", () => (o.value1 === undefined) + " " + (o.value1 == null) + " " + (typeof o.value1 === "number") + " " + typeof o.value1);
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
  Object.seal(o);
  attempt("the holder of a member of a literal is sealed, asked directly", () => (o.value2 === undefined) + " " + (o.value2 == null) + " " + (typeof o.value2 === "number") + " " + typeof o.value2);
  attempt("the holder of a member of a literal is sealed, asked by a typed function", () => ask2(o));
  attempt("the holder of a member of a literal is sealed, asked by a callback", () => [o].filter(q => q.value2 === undefined).length + " " + [o].filter(q => typeof q.value2 === "number").length);
  attempt("the holder of a member of a literal is sealed, used", () => o.value2 + o.other2);
  attempt("the holder of a member of a literal is sealed, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of a member of a literal is sealed, copied", () => JSON.stringify({ ...o }));
  attempt("the holder of a member of a literal is sealed, a typed store", () => (o.value2 = 5));
  attempt("the holder of a member of a literal is sealed, asked after the store", () => (o.value2 === undefined) + " " + (o.value2 == null) + " " + (typeof o.value2 === "number") + " " + typeof o.value2);
}

block2();

interface C3 {
  value3: number;
  other3: number;
}

function ask3(o: C3): string {
  return (o.value3 === undefined) + " " + (o.value3 == null) + " " + (typeof o.value3 === "number") + " " + typeof o.value3;
}

function block3(): void {
  const o: C3 = { value3: 1, other3: 2 };
  Reflect.preventExtensions(o);
  attempt("the holder of a member of a literal is kept from growing, asked directly", () => (o.value3 === undefined) + " " + (o.value3 == null) + " " + (typeof o.value3 === "number") + " " + typeof o.value3);
  attempt("the holder of a member of a literal is kept from growing, asked by a typed function", () => ask3(o));
  attempt("the holder of a member of a literal is kept from growing, asked by a callback", () => [o].filter(q => q.value3 === undefined).length + " " + [o].filter(q => typeof q.value3 === "number").length);
  attempt("the holder of a member of a literal is kept from growing, used", () => o.value3 + o.other3);
  attempt("the holder of a member of a literal is kept from growing, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of a member of a literal is kept from growing, copied", () => JSON.stringify({ ...o }));
  attempt("the holder of a member of a literal is kept from growing, a typed store", () => (o.value3 = 5));
  attempt("the holder of a member of a literal is kept from growing, asked after the store", () => (o.value3 === undefined) + " " + (o.value3 == null) + " " + (typeof o.value3 === "number") + " " + typeof o.value3);
}

block3();

interface C4 {
  value4: number;
  other4: number;
}

function ask4(o: C4): string {
  return (o.value4 === undefined) + " " + (o.value4 == null) + " " + (typeof o.value4 === "number") + " " + typeof o.value4;
}

function block4(): void {
  const o: C4 = { value4: 1, other4: 2 };
  Object.defineProperty(o, "value4", { writable: false });
  attempt("a member of a literal is made read-only, asked directly", () => (o.value4 === undefined) + " " + (o.value4 == null) + " " + (typeof o.value4 === "number") + " " + typeof o.value4);
  attempt("a member of a literal is made read-only, asked by a typed function", () => ask4(o));
  attempt("a member of a literal is made read-only, asked by a callback", () => [o].filter(q => q.value4 === undefined).length + " " + [o].filter(q => typeof q.value4 === "number").length);
  attempt("a member of a literal is made read-only, used", () => o.value4 + o.other4);
  attempt("a member of a literal is made read-only, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a member of a literal is made read-only, copied", () => JSON.stringify({ ...o }));
  attempt("a member of a literal is made read-only, a typed store", () => (o.value4 = 5));
  attempt("a member of a literal is made read-only, asked after the store", () => (o.value4 === undefined) + " " + (o.value4 == null) + " " + (typeof o.value4 === "number") + " " + typeof o.value4);
}

block4();

class B5 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

class C5 extends B5 {
  extra = 2;
}

function ask5(o: B5): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block5(): void {
  const o = new C5();
  Object.freeze(o);
  attempt("the holder of an inherited field is frozen, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("the holder of an inherited field is frozen, asked by a typed function", () => ask5(o));
  attempt("the holder of an inherited field is frozen, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("the holder of an inherited field is frozen, used", () => o.value + o.extra);
  attempt("the holder of an inherited field is frozen, by the method of the base", () => o.twice());
  attempt("the holder of an inherited field is frozen, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of an inherited field is frozen, a typed store", () => (o.value = 5));
  attempt("the holder of an inherited field is frozen, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
}

block5();

class B6 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

class C6 extends B6 {
  extra = 2;
}

function ask6(o: B6): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block6(): void {
  const o = new C6();
  Object.seal(o);
  attempt("the holder of an inherited field is sealed, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("the holder of an inherited field is sealed, asked by a typed function", () => ask6(o));
  attempt("the holder of an inherited field is sealed, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("the holder of an inherited field is sealed, used", () => o.value + o.extra);
  attempt("the holder of an inherited field is sealed, by the method of the base", () => o.twice());
  attempt("the holder of an inherited field is sealed, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of an inherited field is sealed, a typed store", () => (o.value = 5));
  attempt("the holder of an inherited field is sealed, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
}

block6();

class B7 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

class C7 extends B7 {
  extra = 2;
}

function ask7(o: B7): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block7(): void {
  const o = new C7();
  Reflect.preventExtensions(o);
  attempt("the holder of an inherited field is kept from growing, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("the holder of an inherited field is kept from growing, asked by a typed function", () => ask7(o));
  attempt("the holder of an inherited field is kept from growing, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("the holder of an inherited field is kept from growing, used", () => o.value + o.extra);
  attempt("the holder of an inherited field is kept from growing, by the method of the base", () => o.twice());
  attempt("the holder of an inherited field is kept from growing, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("the holder of an inherited field is kept from growing, a typed store", () => (o.value = 5));
  attempt("the holder of an inherited field is kept from growing, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
}

block7();

class B8 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

class C8 extends B8 {
  extra = 2;
}

function ask8(o: B8): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block8(): void {
  const o = new C8();
  Object.defineProperty(o, "value", { writable: false });
  attempt("an inherited field is made read-only, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("an inherited field is made read-only, asked by a typed function", () => ask8(o));
  attempt("an inherited field is made read-only, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("an inherited field is made read-only, used", () => o.value + o.extra);
  attempt("an inherited field is made read-only, by the method of the base", () => o.twice());
  attempt("an inherited field is made read-only, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("an inherited field is made read-only, a typed store", () => (o.value = 5));
  attempt("an inherited field is made read-only, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
}

block8();

export {};

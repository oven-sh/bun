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
  constructor() {
    Object.defineProperty(this, "value", { value: "text", writable: true, enumerable: true, configurable: true });
  }
  twice(): number {
    return this.value * 2;
  }
}

function ask1(o: C1): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block1(): void {
  const o = new C1();
  attempt("written by its own constructor, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by its own constructor, asked by a typed function", () => ask1(o));
  attempt("written by its own constructor, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by its own constructor, used", () => o.value + 1);
  attempt("written by its own constructor, by its own method", () => o.twice());
}

block1();

class C2 {
  value = 1;
  spoil(): void {
    Object.defineProperty(this, "value", { value: "text", writable: true, enumerable: true, configurable: true });
  }
  twice(): number {
    return this.value * 2;
  }
}

function ask2(o: C2): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block2(): void {
  const o = new C2();
  o.spoil();
  attempt("written by its own method, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by its own method, asked by a typed function", () => ask2(o));
  attempt("written by its own method, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by its own method, used", () => o.value + 1);
  attempt("written by its own method, by its own method", () => o.twice());
}

block2();

class B3 {
  constructor() {
    Object.defineProperty(this, "value", { value: "text", writable: true, enumerable: true, configurable: true });
  }
}

class C3 extends B3 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask3(o: C3): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block3(): void {
  const o = new C3();
  attempt("written by the constructor of its base, before the field is defined, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by the constructor of its base, before the field is defined, asked by a typed function", () => ask3(o));
  attempt("written by the constructor of its base, before the field is defined, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by the constructor of its base, before the field is defined, used", () => o.value + 1);
  attempt("written by the constructor of its base, before the field is defined, by its own method", () => o.twice());
}

block3();

class B4 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

class C4 extends B4 {
  constructor() {
    super();
    Object.defineProperty(this, "value", { value: "text", writable: true, enumerable: true, configurable: true });
  }
}

function ask4(o: B4): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block4(): void {
  const o = new C4();
  attempt("written by the constructor of a subclass, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by the constructor of a subclass, asked by a typed function", () => ask4(o));
  attempt("written by the constructor of a subclass, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by the constructor of a subclass, used", () => o.value + 1);
  attempt("written by the constructor of a subclass, by its own method", () => o.twice());
}

block4();

class C5 {
  value = 1;
  later = (() => {
    Object.defineProperty(this, "value", { value: "text", writable: true, enumerable: true, configurable: true });
    return 2;
  })();
  twice(): number {
    return this.value * 2;
  }
}

function ask5(o: C5): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block5(): void {
  const o = new C5();
  attempt("written by an initializer of a later field, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by an initializer of a later field, asked by a typed function", () => ask5(o));
  attempt("written by an initializer of a later field, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by an initializer of a later field, used", () => o.value + 1);
  attempt("written by an initializer of a later field, by its own method", () => o.twice());
}

block5();

export {};

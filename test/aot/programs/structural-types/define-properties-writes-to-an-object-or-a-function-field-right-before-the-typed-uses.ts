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
  Object.defineProperties(o, { value: { value: undefined } });
  attempt("an object field becomes undefined, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value);
  attempt("an object field becomes undefined, asked by a typed function", () => ask1(o));
  attempt("an object field becomes undefined, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "object").length);
  attempt("an object field becomes undefined, used", () => o.value.depth);
  attempt("an object field becomes undefined, by its own method", () => o.depth());
  attempt("an object field becomes undefined, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("an object field becomes undefined, a typed store", () => (o.value = { depth: 2 }));
  attempt("an object field becomes undefined, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value);
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
  Object.defineProperties(o, { value: { value: 5 } });
  attempt("an object field becomes a value of another kind, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value);
  attempt("an object field becomes a value of another kind, asked by a typed function", () => ask2(o));
  attempt("an object field becomes a value of another kind, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "object").length);
  attempt("an object field becomes a value of another kind, used", () => o.value.depth);
  attempt("an object field becomes a value of another kind, by its own method", () => o.depth());
  attempt("an object field becomes a value of another kind, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("an object field becomes a value of another kind, a typed store", () => (o.value = { depth: 2 }));
  attempt("an object field becomes a value of another kind, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "object") + " " + typeof o.value);
}

block2();

class C3 {
  value: () => number = () => 1;
  run(): number {
    return this.value();
  }
}

function ask3(o: C3): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value;
}

function block3(): void {
  const o = new C3();
  Object.defineProperties(o, { value: { value: undefined } });
  attempt("a function field becomes undefined, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
  attempt("a function field becomes undefined, asked by a typed function", () => ask3(o));
  attempt("a function field becomes undefined, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("a function field becomes undefined, used", () => o.value());
  attempt("a function field becomes undefined, by its own method", () => o.run());
  attempt("a function field becomes undefined, listed", () => Object.keys(o).join());
  attempt("a function field becomes undefined, a typed store", () => (o.value = () => 2));
  attempt("a function field becomes undefined, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
}

block3();

class C4 {
  value: () => number = () => 1;
  run(): number {
    return this.value();
  }
}

function ask4(o: C4): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value;
}

function block4(): void {
  const o = new C4();
  Object.defineProperties(o, { value: { value: 5 } });
  attempt("a function field becomes a value of another kind, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
  attempt("a function field becomes a value of another kind, asked by a typed function", () => ask4(o));
  attempt("a function field becomes a value of another kind, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("a function field becomes a value of another kind, used", () => o.value());
  attempt("a function field becomes a value of another kind, by its own method", () => o.run());
  attempt("a function field becomes a value of another kind, listed", () => Object.keys(o).join());
  attempt("a function field becomes a value of another kind, a typed store", () => (o.value = () => 2));
  attempt("a function field becomes a value of another kind, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
}

block4();

export {};

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
  Object.defineProperties(o, { value: { value: undefined } });
  attempt("a number field becomes undefined, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("a number field becomes undefined, asked by a typed function", () => ask1(o));
  attempt("a number field becomes undefined, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("a number field becomes undefined, used", () => o.value + 1);
  attempt("a number field becomes undefined, by its own method", () => o.twice());
  attempt("a number field becomes undefined, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a number field becomes undefined, a typed store", () => (o.value = 5));
  attempt("a number field becomes undefined, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
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
  Object.defineProperties(o, { value: { value: "text" } });
  attempt("a number field becomes a value of another kind, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("a number field becomes a value of another kind, asked by a typed function", () => ask2(o));
  attempt("a number field becomes a value of another kind, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "number").length);
  attempt("a number field becomes a value of another kind, used", () => o.value + 1);
  attempt("a number field becomes a value of another kind, by its own method", () => o.twice());
  attempt("a number field becomes a value of another kind, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a number field becomes a value of another kind, a typed store", () => (o.value = 5));
  attempt("a number field becomes a value of another kind, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value);
}

block2();

class C3 {
  value = "s";
  size(): number {
    return this.value.length;
  }
}

function ask3(o: C3): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value;
}

function block3(): void {
  const o = new C3();
  Object.defineProperties(o, { value: { value: undefined } });
  attempt("a string field becomes undefined, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
  attempt("a string field becomes undefined, asked by a typed function", () => ask3(o));
  attempt("a string field becomes undefined, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "string").length);
  attempt("a string field becomes undefined, used", () => o.value.length);
  attempt("a string field becomes undefined, by its own method", () => o.size());
  attempt("a string field becomes undefined, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a string field becomes undefined, a typed store", () => (o.value = "t"));
  attempt("a string field becomes undefined, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
}

block3();

class C4 {
  value = "s";
  size(): number {
    return this.value.length;
  }
}

function ask4(o: C4): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value;
}

function block4(): void {
  const o = new C4();
  Object.defineProperties(o, { value: { value: 7 } });
  attempt("a string field becomes a value of another kind, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
  attempt("a string field becomes a value of another kind, asked by a typed function", () => ask4(o));
  attempt("a string field becomes a value of another kind, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "string").length);
  attempt("a string field becomes a value of another kind, used", () => o.value.length);
  attempt("a string field becomes a value of another kind, by its own method", () => o.size());
  attempt("a string field becomes a value of another kind, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a string field becomes a value of another kind, a typed store", () => (o.value = "t"));
  attempt("a string field becomes a value of another kind, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "string") + " " + typeof o.value);
}

block4();

class C5 {
  value = true;
  word(): string {
    return this.value ? "yes" : "no";
  }
}

function ask5(o: C5): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value;
}

function block5(): void {
  const o = new C5();
  Object.defineProperties(o, { value: { value: undefined } });
  attempt("a boolean field becomes undefined, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value);
  attempt("a boolean field becomes undefined, asked by a typed function", () => ask5(o));
  attempt("a boolean field becomes undefined, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "boolean").length);
  attempt("a boolean field becomes undefined, used", () => o.value ? "truthy" : "falsy");
  attempt("a boolean field becomes undefined, by its own method", () => o.word());
  attempt("a boolean field becomes undefined, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a boolean field becomes undefined, a typed store", () => (o.value = false));
  attempt("a boolean field becomes undefined, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value);
}

block5();

class C6 {
  value = true;
  word(): string {
    return this.value ? "yes" : "no";
  }
}

function ask6(o: C6): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value;
}

function block6(): void {
  const o = new C6();
  Object.defineProperties(o, { value: { value: "text" } });
  attempt("a boolean field becomes a value of another kind, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value);
  attempt("a boolean field becomes a value of another kind, asked by a typed function", () => ask6(o));
  attempt("a boolean field becomes a value of another kind, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "boolean").length);
  attempt("a boolean field becomes a value of another kind, used", () => o.value ? "truthy" : "falsy");
  attempt("a boolean field becomes a value of another kind, by its own method", () => o.word());
  attempt("a boolean field becomes a value of another kind, listed", () => Object.keys(o).join() + " " + JSON.stringify(o));
  attempt("a boolean field becomes a value of another kind, a typed store", () => (o.value = false));
  attempt("a boolean field becomes a value of another kind, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "boolean") + " " + typeof o.value);
}

block6();

export {};

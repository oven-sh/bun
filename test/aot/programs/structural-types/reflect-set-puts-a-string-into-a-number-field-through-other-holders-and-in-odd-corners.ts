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
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block1(): void {
  const o = new C1();
  const list: C1[] = [o];
  Reflect.set(list[0], "value", "text");
  attempt("written through an element of a list, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written through an element of a list, asked by a typed function", () => ask1(o));
  attempt("written through an element of a list, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written through an element of a list, used", () => o.value + 1);
  attempt("written through an element of a list, by its own method", () => o.twice());
}

block1();

class C2 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask2(o: C2): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block2(): void {
  const o = new C2();
  const map = new Map<string, C2>([["k", o]]);
  for (const target of map.values()) {
    Reflect.set(target, "value", "text");
  }
  attempt("written through a value of a map, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written through a value of a map, asked by a typed function", () => ask2(o));
  attempt("written through a value of a map, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written through a value of a map, used", () => o.value + 1);
  attempt("written through a value of a map, by its own method", () => o.twice());
}

block2();

class C3 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

class H3 {
  constructor(public held: C3) {}
}

function ask3(o: C3): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block3(): void {
  const o = new C3();
  const holder = new H3(o);
  Reflect.set(holder.held, "value", "text");
  attempt("written through a field of a holder, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written through a field of a holder, asked by a typed function", () => ask3(o));
  attempt("written through a field of a holder, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written through a field of a holder, used", () => o.value + 1);
  attempt("written through a field of a holder, by its own method", () => o.twice());
}

block3();

class C4 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask4(o: C4): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block4(): void {
  const o = new C4();
  for (const target of Object.values({ o })) {
    Reflect.set(target, "value", "text");
  }
  attempt("written through what Object.values gives, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written through what Object.values gives, asked by a typed function", () => ask4(o));
  attempt("written through what Object.values gives, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written through what Object.values gives, used", () => o.value + 1);
  attempt("written through what Object.values gives, by its own method", () => o.twice());
}

block4();

class C5 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask5(o: C5): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block5(): void {
  const o = new C5();
  const spoil = () => {
    Reflect.set(o, "value", "text");
  };
  spoil();
  attempt("written by a closure made earlier, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a closure made earlier, asked by a typed function", () => ask5(o));
  attempt("written by a closure made earlier, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a closure made earlier, used", () => o.value + 1);
  attempt("written by a closure made earlier, by its own method", () => o.twice());
}

block5();

class C6 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask6(o: C6): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block6(): void {
  const o = new C6();
  ((ignored = (() => {
    Reflect.set(o, "value", "text");
    return 0;
  })()) => ignored)();
  attempt("written by a default parameter, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a default parameter, asked by a typed function", () => ask6(o));
  attempt("written by a default parameter, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a default parameter, used", () => o.value + 1);
  attempt("written by a default parameter, by its own method", () => o.twice());
}

block6();

class C7 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask7(o: C7): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block7(): void {
  const o = new C7();
  ({
    [(() => {
      Reflect.set(o, "value", "text");
      return "k";
    })()]: 1,
  });
  attempt("written while a key is computed, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written while a key is computed, asked by a typed function", () => ask7(o));
  attempt("written while a key is computed, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written while a key is computed, used", () => o.value + 1);
  attempt("written while a key is computed, by its own method", () => o.twice());
}

block7();

class C8 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask8(o: C8): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block8(): void {
  const o = new C8();
  [2, 1].toSorted((a, b) => {
    Reflect.set(o, "value", "text");
    return a - b;
  });
  attempt("written by a comparator, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a comparator, asked by a typed function", () => ask8(o));
  attempt("written by a comparator, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a comparator, used", () => o.value + 1);
  attempt("written by a comparator, by its own method", () => o.twice());
}

block8();

class C9 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask9(o: C9): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block9(): void {
  const o = new C9();
  JSON.stringify({ a: 1 }, (key, value: unknown) => {
    Reflect.set(o, "value", "text");
    return value;
  });
  attempt("written by a replacer of JSON.stringify, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a replacer of JSON.stringify, asked by a typed function", () => ask9(o));
  attempt("written by a replacer of JSON.stringify, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a replacer of JSON.stringify, used", () => o.value + 1);
  attempt("written by a replacer of JSON.stringify, by its own method", () => o.twice());
}

block9();

export {};

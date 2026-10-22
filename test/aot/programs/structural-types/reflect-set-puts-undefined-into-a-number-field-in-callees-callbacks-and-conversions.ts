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

function write1(target: C1): void {
  Reflect.set(target, "value", undefined);
}

function ask1(o: C1): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block1(): void {
  const o = new C1();
  write1(o);
  attempt("written by a callee that takes its type, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a callee that takes its type, asked by a typed function", () => ask1(o));
  attempt("written by a callee that takes its type, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a callee that takes its type, used", () => o.value + 1);
  attempt("written by a callee that takes its type, by its own method", () => o.twice());
}

block1();

class C2 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function write2(target: object): void {
  Reflect.set(target, "value", undefined);
}

function ask2(o: C2): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block2(): void {
  const o = new C2();
  write2(o);
  attempt("written by a callee that takes any object, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a callee that takes any object, asked by a typed function", () => ask2(o));
  attempt("written by a callee that takes any object, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a callee that takes any object, used", () => o.value + 1);
  attempt("written by a callee that takes any object, by its own method", () => o.twice());
}

block2();

class C3 {
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
  [o].forEach(target => {
    Reflect.set(target, "value", undefined);
  });
  attempt("written by a callback of forEach, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a callback of forEach, asked by a typed function", () => ask3(o));
  attempt("written by a callback of forEach, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a callback of forEach, used", () => o.value + 1);
  attempt("written by a callback of forEach, by its own method", () => o.twice());
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
  const other = {
    get trigger(): number {
      Reflect.set(o, "value", undefined);
      return 0;
    },
  };
  other.trigger;
  attempt("written by a getter that is read in between, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a getter that is read in between, asked by a typed function", () => ask4(o));
  attempt("written by a getter that is read in between, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a getter that is read in between, used", () => o.value + 1);
  attempt("written by a getter that is read in between, by its own method", () => o.twice());
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
  const other = {
    toString(): string {
      Reflect.set(o, "value", undefined);
      return "";
    },
  };
  `${other}`;
  attempt("written while another object is turned into text, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written while another object is turned into text, asked by a typed function", () => ask5(o));
  attempt("written while another object is turned into text, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written while another object is turned into text, used", () => o.value + 1);
  attempt("written while another object is turned into text, by its own method", () => o.twice());
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

async function block6(): Promise<void> {
  const o = new C6();
  await Promise.resolve(o).then(target => {
    Reflect.set(target, "value", undefined);
  });
  attempt("written by a promise reaction, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a promise reaction, asked by a typed function", () => ask6(o));
  attempt("written by a promise reaction, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a promise reaction, used", () => o.value + 1);
  attempt("written by a promise reaction, by its own method", () => o.twice());
}

await block6();

class C7 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask7(o: C7): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

async function block7(): Promise<void> {
  const o = new C7();
  const pending = Promise.resolve().then(() => {
    Reflect.set(o, "value", undefined);
  });
  const before = o.value;
  await pending;
  attempt("written during an await, read before the await", () => before);
  attempt("written during an await, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written during an await, asked by a typed function", () => ask7(o));
  attempt("written during an await, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written during an await, used", () => o.value + 1);
  attempt("written during an await, by its own method", () => o.twice());
}

await block7();

class C8 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function* steps8(target: C8): Generator<number> {
  yield 1;
  Reflect.set(target, "value", undefined);
  yield 2;
}

function ask8(o: C8): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block8(): void {
  const o = new C8();
  for (const step of steps8(o)) void step;
  attempt("written by a step of a generator, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written by a step of a generator, asked by a typed function", () => ask8(o));
  attempt("written by a step of a generator, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written by a step of a generator, used", () => o.value + 1);
  attempt("written by a step of a generator, by its own method", () => o.twice());
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
  try {
    o.twice();
  } finally {
    Reflect.set(o, "value", undefined);
  }
  attempt("written in a finally block, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written in a finally block, asked by a typed function", () => ask9(o));
  attempt("written in a finally block, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written in a finally block, used", () => o.value + 1);
  attempt("written in a finally block, by its own method", () => o.twice());
}

block9();

class C10 {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

function ask10(o: C10): string {
  return (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block10(): void {
  const o = new C10();
  try {
    throw new RangeError("r");
  } catch {
    Reflect.set(o, "value", undefined);
  }
  attempt("written in a catch block, asked directly", () => (o.value === undefined) + " " + (typeof o.value === "number") + " " + typeof o.value);
  attempt("written in a catch block, asked by a typed function", () => ask10(o));
  attempt("written in a catch block, asked by a callback", () => [o].filter(q => typeof q.value === "number").length);
  attempt("written in a catch block, used", () => o.value + 1);
  attempt("written in a catch block, by its own method", () => o.twice());
}

block10();

export {};

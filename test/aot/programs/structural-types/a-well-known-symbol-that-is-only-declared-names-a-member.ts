function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

declare global {
  interface SymbolConstructor {
    readonly special: unique symbol;
    readonly other: unique symbol;
  }
}

class Marked {
  [Symbol.special]: number = 1;
  plain: number = 2;
  [Symbol.other](): string {
    return "the method ran";
  }
  read(): number {
    return this[Symbol.special];
  }
}

interface HasSpecial {
  [Symbol.special]: number;
}

function specialOf(value: HasSpecial): number {
  return value[Symbol.special];
}

show("the symbol", () => [Symbol.special, typeof Symbol.special]);
show("are the two the same", () => Object.is(Symbol.special, Symbol.other));
show("its description", () => Symbol.special.description);

const marked = new Marked();
show("read", () => [marked[Symbol.special], marked.read(), specialOf(marked)]);
show("keys", () => Object.keys(marked));
show("own symbols", () => Object.getOwnPropertySymbols(marked).length);
show("JSON", () => JSON.stringify(marked));
show("names of the prototype", () => Object.getOwnPropertyNames(Marked.prototype));
show("the method has the same name, and the field hides it", () => typeof marked[Symbol.other]);
show("the method called", () => marked[Symbol.other]());
show("the method on the prototype", () => Marked.prototype[Symbol.other]());

const literal = { [Symbol.special]: 5, plain: 6 };
show("a literal", () => [specialOf(literal), Object.keys(literal), JSON.stringify(literal)]);
show("both through one function", () => [specialOf(marked), specialOf(literal)]);

marked[Symbol.special] = 9;
show("after a store", () => [marked.read(), Object.keys(marked), JSON.stringify(marked)]);
show("by the word", () => {
  const byName: Record<string, unknown> = { ...marked };
  return byName["undefined"];
});
show("a real symbol beside it", () => {
  const both = { [Symbol.iterator]: 1, [Symbol.special]: 2 };
  return [Object.keys(both), Object.getOwnPropertySymbols(both).length];
});

export {};

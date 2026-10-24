function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const log: string[] = [];

class Money {
  amount: number = 5;
  [Symbol.toPrimitive](hint: "number"): number {
    log.push("toPrimitive " + hint + " " + (hint === "number"));
    return this.amount;
  }
}

class Entry {
  value: number = 1;
  toJSON(key: "first"): string {
    log.push("toJSON " + typeof key + " '" + key + "' " + (key === "first"));
    return "entry under " + key;
  }
}

class Thenable {
  then(resolve: (value: number) => void): void {
    log.push("then got " + arguments.length + " operands");
    resolve(42);
  }
}

class Counter implements Iterator<number, string, number> {
  n: number = 0;
  next(step: number): IteratorResult<number, string> {
    log.push("next " + typeof step + " " + arguments.length);
    this.n += step;
    if (log.length > 40) return { done: true, value: "too many" };
    return this.n < 3 || Number.isNaN(this.n) ? { done: false, value: this.n } : { done: true, value: "end" };
  }
  return(reason: string): IteratorResult<number, string> {
    log.push("return " + typeof reason + " " + arguments.length);
    return { done: true, value: reason };
  }
  [Symbol.iterator](): Iterator<number> {
    return this;
  }
}

class Picky {
  static [Symbol.hasInstance](value: Money): boolean {
    log.push("hasInstance " + typeof value + " " + typeof value.amount);
    return value.amount === 5;
  }
}

class Splitter {
  [Symbol.split](text: string, limit: number): string[] {
    log.push("split " + typeof text + " " + typeof limit);
    return [text, String(limit)];
  }
  [Symbol.replace](text: string, replacement: string): string {
    log.push("replace " + typeof text + " " + typeof replacement);
    return text + "/" + replacement;
  }
}

function flush(): void {
  for (const entry of log.splice(0)) console.log("  " + entry);
}

const money = new Money();
show("unary plus", () => +money);
show("template", () => `${money}`);
show("plus a string", () => money + "");
show("String()", () => String(money));
show("as a key", () => Object.keys({ [`${money}`]: 1 }).join());
show("minus", () => -money);
show("Number()", () => Number(money));
show("in an array join", () => [money, money].join());
flush();

show("JSON under first", () => JSON.stringify({ first: new Entry() }));
show("JSON under second", () => JSON.stringify({ second: new Entry() }));
show("JSON in an array", () => JSON.stringify([new Entry()]));
show("JSON at the top", () => JSON.stringify(new Entry()));
flush();

show("for-of", () => {
  const seen: number[] = [];
  for (const n of new Counter()) {
    seen.push(n);
    if (seen.length === 2) break;
  }
  return seen.map(n => String(n)).join();
});
flush();
show("destructuring", () => {
  const [a] = new Counter();
  return a;
});
flush();
show("honest next", () => new Counter().next(2).value);
flush();

show("instanceof with money", () => money instanceof Picky);
const lessPicky: { [Symbol.hasInstance](value: object): boolean } = Picky;
show("instanceof with something else", () => new Entry() instanceof lessPicky);
show("instanceof with a function", () => flush instanceof lessPicky);
flush();

show("split without a limit", () => "a,b".split(new Splitter()));
show("split with a limit", () => "a,b".split(new Splitter(), 1));
show("replace", () => "a,b".replace(new Splitter(), "x"));
flush();

async function main(): Promise<void> {
  const value = await new Thenable();
  console.log("awaited: " + typeof value + " " + value);
  flush();
  console.log("resolved: " + (await Promise.resolve(new Thenable())));
  flush();
}
main();

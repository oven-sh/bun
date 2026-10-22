function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

class Base {
  name: string = "base";
  greet(suffix: string): string {
    return "base greets " + this.name + suffix;
  }
  static make(): string {
    return "made by Base";
  }
}

class Child extends Base {
  name: string = "child";
  count: number = 0;
  greet(suffix: string): string {
    return "child greets " + this.name + suffix;
  }
  async later(suffix: string): Promise<string> {
    const before = super.greet(suffix);
    await null;
    this.count++;
    return before + " | " + super.greet(suffix) + " | " + this.greet(suffix) + " | " + this.count;
  }
  *steps(suffix: string): Generator<string, string, void> {
    yield super.greet(suffix);
    this.count++;
    yield this.greet(suffix);
    return super.greet(suffix) + " " + this.count;
  }
  async *stream(suffix: string): AsyncGenerator<string, void, void> {
    yield super.greet(suffix);
    await null;
    yield this.greet(suffix) + " " + ++this.count;
  }
  arrow = async (suffix: string): Promise<string> => {
    await null;
    return this.greet(suffix);
  };
  async nested(): Promise<string> {
    const inner = async (): Promise<string> => {
      await null;
      return super.greet("!") + " " + this.name;
    };
    await null;
    return inner();
  }
  static async makeLater(): Promise<string> {
    await null;
    return super.make() + " through " + this.name;
  }
}

const child = new Child();
console.log(await child.later("."));
console.log([...child.steps("?")].join(" | "));
const stepping = child.steps("#");
console.log(text(stepping.next()) + text(stepping.next()) + text(stepping.next()));
for await (const line of child.stream("~")) console.log(line);
console.log(await child.arrow("*"));
console.log(await child.nested());
console.log(await Child.makeLater());

const waiting = child.later("@");
child.name = "renamed";
Base.prototype.greet = function (this: Base, suffix: string): string {
  return "a new base greets " + this.name + suffix;
};
console.log(await waiting);

async function counts(a: number, b?: number, ...rest: number[]): Promise<string> {
  const before = arguments.length;
  await null;
  a += 100;
  return before + " " + arguments.length + " " + text(arguments[0]) + " " + text(a) + " " + text(b) + " " + text(rest) + " " + text(Array.from(arguments));
}
console.log(await counts(1));
console.log(await counts(1, undefined));
console.log(await counts(1, 2, 3, 4));

async function simple(a: number, b: number): Promise<string> {
  await null;
  a = 50;
  return text(arguments[0]) + " " + text(arguments[1]) + " " + arguments.length;
}
console.log(await simple(1, 2));

function* listed(a: number, b: number): Generator<number, string, void> {
  yield arguments.length;
  a = 9;
  yield arguments[0];
  return Array.from(arguments).join();
}
console.log([...listed(1, 2)].join() + " " + text(listed.call(null, 3, 4).next()));

const detached: (suffix: string) => Promise<string> = child.later;
console.log(await detached.call(new Child(), "$"));
console.log(await detached("%").then(text, error => "rejected " + (error instanceof Error ? error.constructor.name : typeof error)));

interface Named {
  name: string;
  count: number;
}
async function withThis(this: Named, extra: number): Promise<string> {
  const me = this;
  await null;
  this.count += extra;
  return this.name + " " + this.count + " " + (me === this);
}
console.log(await withThis.call({ name: "literal", count: 1 }, 2));
console.log(await withThis.apply(child, [5]));
console.log(await withThis.bind({ name: "bound", count: 10 })(1));

export {};

export {};

declare global {
  namespace Reflect {
    function metadata(key: string, value: unknown): (target: object, member?: string | symbol) => void;
  }
}

const seen: string[] = [];

function nameOf(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(nameOf).join(" ") + "]";
  return typeof value === "function" ? value.name : String(value);
}

Reflect.metadata = (key, value) => (target, member) => {
  seen.push(String(member ?? "the class") + " " + key + " " + nameOf(value));
};

function noted(target: object, member?: string | symbol, extra?: unknown): void {}

class Dog {}
interface Shape {
  sides: number;
}
enum Color {
  Red,
}
enum Word {
  Yes = "yes",
}

@noted
class Everything<T> {
  @noted a: number = 1;
  @noted b: string = "s";
  @noted c: boolean = true;
  @noted d: Dog = new Dog();
  @noted e: Shape = { sides: 1 };
  @noted f: number | string = 1;
  @noted g: number[] = [];
  @noted h: () => void = () => {};
  @noted i: Color = Color.Red;
  @noted j: Word = Word.Yes;
  @noted k: unknown = 1;
  @noted l: bigint = 1n;
  @noted m: symbol = Symbol();
  @noted n: [number, string] = [1, "s"];
  @noted o: "on" | "off" = "on";
  @noted p?: number;
  @noted q: T | undefined = undefined;
  @noted r: Promise<number> = Promise.resolve(1);
  @noted s: null = null;
  @noted t: number | undefined = undefined;
  @noted u: Map<string, number> = new Map();
  @noted v: object = {};
  @noted w: 5 = 5;
  constructor(first: number, second: Dog, third?: string) {}
  @noted
  method(first: string, second: Shape, ...rest: number[]): boolean {
    return true;
  }
  @noted
  async later(): Promise<void> {}
  @noted
  get computed(): number {
    return 1;
  }
}

for (const line of seen) console.log(line);
console.log("keys " + Object.keys(new Everything<number>(1, new Dog())).join(""));

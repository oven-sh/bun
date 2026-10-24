function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

const registry: Item[] = [];

function weightOf(item: Item): number {
  return item.weight;
}
function nameLength(item: Item): number {
  return item.name.length;
}

class Wrapper {
  inner: Item;
  constructor(inner: Item) {
    this.inner = inner;
  }
  weight(): number {
    return this.inner.weight;
  }
}

class Item {
  weight: number = 3;
  name: string = "item";
  parent: Item | null = null;
  toHelper(): number {
    return weightOf(this);
  }
  toSecondHelper(): number {
    return nameLength(this);
  }
  register(): number {
    return registry.push(this);
  }
  wrap(): Wrapper {
    return new Wrapper(this);
  }
  adopt(child: Item): void {
    child.parent = this;
  }
  isItem(): boolean {
    return this instanceof Item;
  }
  isSame(other: Item): boolean {
    return this === other;
  }
  names(): string {
    const out: string[] = [];
    for (const key in this) out.push(key);
    return out.join("+");
  }
  copy(): number {
    return { ...this }.weight;
  }
  inList(): number {
    return [this, this].map(weightOf).length;
  }
  captured(): () => number {
    return () => weightOf(this);
  }
}

const item = new Item();
const like = { weight: 30, name: "like", parent: null };
const wrong = { weight: "heavy", name: 5, parent: null };

function all(title: string, receiver: unknown): void {
  show(title + " toHelper", () => item.toHelper.call(receiver));
  show(title + " toSecondHelper", () => item.toSecondHelper.call(receiver));
  show(title + " register", () => item.register.call(receiver));
  show(title + " wrap, then weight", () => item.wrap.call(receiver).weight());
  show(title + " isItem", () => item.isItem.call(receiver));
  show(title + " isSame", () => item.isSame.call(receiver, item));
  show(title + " names", () => item.names.call(receiver));
  show(title + " copy", () => item.copy.call(receiver));
  show(title + " inList", () => item.inList.call(receiver));
  show(title + " captured", () => item.captured.call(receiver)());
  show(title + " adopt", () => {
    const child = new Item();
    item.adopt.call(receiver, child);
    return typeof child.parent + " " + (child.parent === null ? "null" : typeof child.parent?.weight);
  });
}

all("honest", item);
all("look-alike", like);
all("wrong kinds", wrong);
all("nothing", undefined);
all("a number", 5);
all("honest again", new Item());

show("what was registered", () => registry.map(entry => typeof entry).join());
show("weights of what was registered", () => registry.map(entry => {
  try {
    return typeof entry.weight + " " + entry.weight;
  } catch (error) {
    return "threw";
  }
}).join(", "));
show("honest helper", () => weightOf(item) + nameLength(item));

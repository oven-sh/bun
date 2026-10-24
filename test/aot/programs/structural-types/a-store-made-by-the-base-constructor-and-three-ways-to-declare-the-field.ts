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

class Base {
  constructor() {
    this.init();
  }
  init(): void {}
}

class WithInitializer extends Base {
  count: number = 0;
  label: string = "initial";
  init(): void {
    this.count = 5;
    this.label = "early";
  }
}

class SurelyAssigned extends Base {
  count!: number;
  label!: string;
  init(): void {
    this.count = 5;
    this.label = "early";
  }
}

class Declared extends Base {
  declare count: number;
  declare label: string;
  init(): void {
    this.count = 5;
    this.label = "early";
  }
}

class InConstructor extends Base {
  count: number;
  label: string;
  constructor() {
    super();
    this.count = this.readCount() + 1;
    this.label = this.readLabel() + "+";
  }
  readCount(): number {
    return this.count;
  }
  readLabel(): string {
    return this.label;
  }
  init(): void {
    this.count = 5;
    this.label = "early";
  }
}

interface Counted {
  count: number;
  label: string;
}

function all(kind: string, o: Counted): void {
  show(kind + " count", () => o.count);
  show(kind + " count + 1", () => o.count + 1);
  show(kind + " label", () => o.label);
  show(kind + " label.length", () => o.label.length);
  show(kind + " keys", () => Object.keys(o).join());
  show(kind + " JSON", () => JSON.stringify(o));
}

all("with an initializer", new WithInitializer());
all("surely assigned", new SurelyAssigned());
all("declared", new Declared());
all("in the constructor", new InConstructor());

class Parent {
  size: number = 1;
  name: string = "parent";
  sizeSeenByParent: number;
  constructor() {
    this.sizeSeenByParent = this.size;
  }
  parentSize(): number {
    return this.size;
  }
}
class Redeclares extends Parent {
  size: number = 2;
  declare name: string;
}
class Narrower extends Parent {
  declare size: 1;
}
const redeclares = new Redeclares();
show("redeclared: size", () => redeclares.size);
show("redeclared: size as the parent's constructor saw it", () => redeclares.sizeSeenByParent);
show("redeclared: size as the parent's method sees it", () => redeclares.parentSize());
show("redeclared: name", () => redeclares.name);
show("redeclared: keys", () => Object.keys(redeclares).join());
show("narrower: size", () => new Narrower().size);
show("narrower: keys", () => Object.keys(new Narrower()).join());

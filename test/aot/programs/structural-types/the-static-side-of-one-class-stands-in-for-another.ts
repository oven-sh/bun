class Apple {
  static kind = "apple";
  static count = 0;
  static create(): Apple {
    Apple.count++;
    return new Apple();
  }
  static get plural(): string {
    return "apples";
  }
  taste = "sweet";
  bite(): string {
    return "crunch";
  }
}

class Lemon {
  static count = 100;
  static kind = "lemon";
  static create(): Lemon {
    Lemon.count += 10;
    return new Lemon();
  }
  static get plural(): string {
    return "lemons";
  }
  taste = "sour";
  bite(): string {
    return "wince";
  }
}

function grow(Fruit: typeof Apple): string {
  const made = new Fruit();
  const created = Fruit.create();
  return [
    Fruit.kind,
    Fruit.plural,
    Fruit.count,
    Fruit.name,
    made.taste,
    made.bite(),
    created.taste,
    made instanceof Apple,
    made instanceof Fruit,
    created instanceof Fruit,
    made.constructor === Fruit,
    Fruit === Apple,
    Fruit.prototype === Apple.prototype,
  ].join(" ");
}

function construct(Fruit: new () => Apple): string {
  const made = new Fruit();
  return made.taste + " " + made.bite() + " " + (made instanceof Apple);
}

class Orchard {
  constructor(public Fruit: typeof Apple) {}
  harvest(n: number): string {
    const basket: Apple[] = [];
    for (let i = 0; i < n; i++) basket.push(new this.Fruit());
    return basket.map(f => f.bite()).join() + " " + this.Fruit.kind;
  }
}

const Local: typeof Apple = Lemon;
console.log("local: " + Local.kind + " " + new Local().taste + " " + Local.name + " " + (new Local() instanceof Apple));
console.log("parameter, Apple: " + grow(Apple));
console.log("parameter, Lemon: " + grow(Lemon));
console.log("construct signature, Apple: " + construct(Apple));
console.log("construct signature, Lemon: " + construct(Lemon));
console.log("field, Apple: " + new Orchard(Apple).harvest(2));
console.log("field, Lemon: " + new Orchard(Lemon).harvest(2));

const classes: (typeof Apple)[] = [Apple, Lemon, Apple];
console.log("elements: " + classes.map(C => new C().bite()).join());
console.log("static through elements: " + classes.map(C => C.kind + C.count).join());

for (let i = 0; i < 2000; i++) grow(Apple);
console.log("after 2000 honest: " + grow(Lemon));
console.log("counts: " + Apple.count + " " + Lemon.count);

Local.kind = "changed";
console.log("a static stored through the alias: " + Apple.kind + " " + Lemon.kind);

class Juicy extends Local {
  juice = "yes";
}
const juicy = new Juicy();
console.log("a subclass of the alias: " + juicy.taste + " " + juicy.bite() + " " + (juicy instanceof Apple) + " " + (juicy instanceof Lemon));
console.log("its static side: " + Juicy.kind + " " + Juicy.plural + " " + Object.getPrototypeOf(Juicy).name);

const reflected: Apple = Reflect.construct(Apple, [], Lemon);
console.log("constructed for another target: " + reflected.taste + " " + reflected.bite() + " " + (reflected instanceof Apple) + " " + (reflected instanceof Lemon));

export {};

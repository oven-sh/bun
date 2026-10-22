class Base {
  kept = 0;
  set(value: number): this {
    this.kept = value;
    return this;
  }
  greet(): string {
    return "base " + this.kept;
  }
  static make(): string {
    return "base make";
  }
}

class Quiet extends Base {}

class Child extends Base {
  greet(): string {
    return "child > " + super.greet();
  }
}

function put(b: Base): number {
  return b.set(1).kept;
}

function greet(b: Base): string {
  return b.greet();
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += put(new Quiet()) + greet(new Quiet()).length + greet(new Child()).length;
console.log("2000 rounds: " + warm);
console.log("typed as the base: " + put(new Quiet()) + " " + put(new Base()) + " " + put(new Child()));
console.log("typed as itself: " + new Quiet().set(2).kept + " " + new Quiet().greet());
console.log("two receiver classes at one site: " + greet(new Child()) + " | " + greet(new Quiet()) + " | " + greet(new Base()));
console.log("static: " + Quiet.make() + " " + Child.make());
console.log("own: " + Object.hasOwn(Quiet.prototype, "set") + " " + Object.getOwnPropertyNames(Quiet.prototype).join());

export {};

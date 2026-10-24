function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

const seen: string[] = [];

function doubled(target: (this: Meter) => number, context: ClassMethodDecoratorContext<Meter, (this: Meter) => number>) {
  seen.push("method " + String(context.name));
  return function (this: Meter): number {
    return target.call(this) * 2;
  };
}

function plusOne(target: (this: Meter) => number, context: ClassGetterDecoratorContext<Meter, number>) {
  seen.push("getter " + String(context.name));
  return function (this: Meter): number {
    return target.call(this) + 1;
  };
}

function tripled(target: undefined, context: ClassFieldDecoratorContext<Meter, number>) {
  seen.push("field " + String(context.name));
  return function (this: Meter, initial: number): number {
    return initial * 3;
  };
}

function watched(target: ClassAccessorDecoratorTarget<Meter, number>, context: ClassAccessorDecoratorContext<Meter, number>): ClassAccessorDecoratorResult<Meter, number> {
  seen.push("accessor " + String(context.name));
  return {
    get() {
      seen.push("read");
      return target.get.call(this);
    },
    set(value) {
      seen.push("write " + value);
      target.set.call(this, value);
    },
    init(initial) {
      return initial + 100;
    },
  };
}

class Meter {
  @tripled amount = 2;
  @watched accessor level = 1;
  @doubled
  read(): number {
    return this.amount;
  }
  @plusOne
  get next(): number {
    return this.amount;
  }
}

const made = new Meter();
console.log(describe(made));
console.log("amount " + made.amount + " read " + made.read() + " next " + made.next + " level " + made.level);
made.level = 5;
console.log("level " + made.level);
console.log(seen.join(", "));

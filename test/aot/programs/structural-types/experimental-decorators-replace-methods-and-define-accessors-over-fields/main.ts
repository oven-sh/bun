function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

const seen: string[] = [];

function doubled(target: object, key: string, descriptor: TypedPropertyDescriptor<() => number>): void {
  const original = descriptor.value;
  seen.push("method " + key);
  descriptor.value = function (this: unknown): number {
    return original === undefined ? -1 : original.call(this) * 2;
  };
}

function watched(target: object, key: string): void {
  seen.push("field " + key);
  const values = new WeakMap<object, unknown>();
  Object.defineProperty(target, key, {
    get(this: object) {
      seen.push("read " + key);
      return values.get(this);
    },
    set(this: object, value: unknown) {
      seen.push("write " + key);
      values.set(this, value);
    },
    enumerable: true,
    configurable: true,
  });
}

function noted(target: object, key: string, index: number): void {
  seen.push("parameter " + index + " of " + key);
}

class Meter {
  @watched amount = 2;
  plain = 3;
  @doubled
  read(): number {
    return this.amount + this.plain;
  }
  add(@noted n: number): number {
    return this.amount + n;
  }
}

const made = new Meter();
console.log(describe(made));
console.log("amount " + made.amount + " read " + made.read() + " add " + made.add(1));
made.amount = 7;
console.log("amount " + made.amount + " own " + Object.hasOwn(made, "amount"));
console.log(seen.join(", "));

function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

function kind(error: unknown): string {
  return error instanceof ReferenceError ? "a ReferenceError" : error instanceof TypeError ? "a TypeError" : "something else";
}

function Fancy(Base: new () => number[]) {
  return class extends Base {
    label = "fancy";
    static get [Symbol.species](): ArrayConstructor {
      return Array;
    }
    static [Symbol.hasInstance](value: unknown): boolean {
      return Array.isArray(value);
    }
    get [Symbol.toStringTag](): string {
      return "Fancy";
    }
  };
}

const Made = Fancy(Array<number>);
const made = new Made();
made.push(1, 2, 3);
console.log("keys: " + Object.keys(made).join(" ") + " length " + made.length + " label " + made.label);
const mapped = made.map(n => n * 2);
console.log("mapped: " + mapped.join(" ") + " keys " + Object.keys(mapped).join(" ") + " plain: " + (Object.getPrototypeOf(mapped) === Array.prototype));
const plain: unknown = [1];
console.log("instanceof: " + (plain instanceof Made) + " " + (made instanceof Made) + " tag: " + Object.prototype.toString.call(made));

class Base {
  n = 1;
  kind(): string {
    return "base " + this.n;
  }
  get size(): number {
    return 10;
  }
  static make(): string {
    return "base make";
  }
}

class Derived extends Base {
  kind(): string {
    return "derived " + this.n;
  }
  get size(): number {
    return 20;
  }
  static make(): string {
    return "derived make";
  }
}

function kindOf(b: Base): string {
  return b.kind() + " " + b.size;
}

function derivedKind(d: Derived): string {
  return d.kind() + " " + d.size;
}

const d = new Derived();

function round(label: string): void {
  console.log(label + ": " + d.kind() + " " + d.size + " | " + kindOf(d) + " | " + derivedKind(d) + " | " + derivedKind(new Derived()) + " | " + kindOf(new Base()) + " | " + Derived.make() + " | names " + Object.getOwnPropertyNames(Derived.prototype).join());
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += kindOf(d).length + derivedKind(d).length + Derived.make().length;
console.log("2000 honest: " + warm);
round("before");

const kept = Derived.prototype.kind;
const keptSize = Object.getOwnPropertyDescriptor(Derived.prototype, "size");
const keptMake = Derived.make;

const view: { kind?: () => string } = Derived.prototype;
delete view.kind;
round("the method deleted");

Reflect.deleteProperty(Derived.prototype, "size");
round("the getter deleted");

const staticView: { make?: () => string } = Derived;
delete staticView.make;
round("the static method deleted");

Derived.prototype.kind = kept;
if (keptSize) Object.defineProperty(Derived.prototype, "size", keptSize);
Derived.make = keptMake;
round("all three put back");

export {};

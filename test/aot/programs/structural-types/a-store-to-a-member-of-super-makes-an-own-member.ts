class Base {
  value = 1;
  read(): string {
    return "base read " + this.value;
  }
}

class Child extends Base {
  cover(): void {
    super.read = () => "stored through super";
  }
  askAbove(): string {
    return super.read();
  }
}

function readOf(b: Base): string {
  return b.read();
}

const c = new Child();
const other = new Child();

function round(label: string): void {
  console.log(label + ": " + c.read() + " | " + readOf(c) + " | " + c.askAbove() + " | own " + Object.hasOwn(c, "read") + " | on the base " + (Base.prototype.read === original) + " | the other " + readOf(other) + " | keys " + Object.keys(c).join());
}

const original = Base.prototype.read;
let warm = 0;
for (let i = 0; i < 2000; i++) warm += readOf(c).length + c.askAbove().length + readOf(other).length;
console.log("2000 honest: " + warm);
round("before");
c.cover();
round("after the store");
Reflect.deleteProperty(c, "read");
round("uncovered");
c.cover();
round("stored again");

export {};

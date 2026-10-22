// The types of the decorated members are written `parts.Wheel` and `Inner.Seat`: with emitDecoratorMetadata those become values read from a namespace import and from a namespace. A parameter decorator alone is enough for the types of a method's parameters.
import * as parts from "./parts";

declare global {
  namespace Reflect {
    function metadata(key: string, value: unknown): (target: any, member?: string | symbol) => void;
  }
}
const recorded = new Map<string, any>();
Reflect.metadata = (key, value) => (target, member) => {
  recorded.set(key + " " + String(member ?? "class"), value);
};
function noted(...parts: unknown[]): void {}

namespace Inner {
  export class Seat { sit() { return "seat taken"; } }
}

class Car {
  @noted wheel!: parts.Wheel;
  @noted seat!: Inner.Seat;
  drive(@noted engine: parts.Engine): void {}
  @noted set mirror(value: parts.Mirror) {}
}

console.log(new (recorded.get("design:type wheel"))().turn());
console.log(new (recorded.get("design:type seat"))().sit());
console.log(new (recorded.get("design:paramtypes drive")[0])().start());
console.log(new (recorded.get("design:paramtypes mirror")[0])().show());

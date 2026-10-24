import { Core } from "./core.ts";
export class Harmless extends Core {
  navigate(to) { return "to " + to; }
  get isReady() { return true; }
  set target(value) { this.kept = value; }
  static make() { return new Harmless(); }
}
export class Overrides extends Core {
  area() { return 20 + super.area(); }
  get size() { return 30; }
}
export class NamedLikeFields extends Core {
  get first() { return "inherited first"; }
  set second(value) { this.caught = value; }
  late() { return "a method"; }
}
export class Thenable extends Core {
  then(resolve) { resolve(new Core({ first: "by then" })); }
}
export class Converts extends Core {
  toJSON() { return { by: "toJSON" }; }
  toString() { return "by toString"; }
  valueOf() { return 7; }
}
export class BySymbols extends Core {
  *[Symbol.iterator]() { yield 1; yield 2; }
  [Symbol.toPrimitive]() { return "by toPrimitive"; }
  get [Symbol.toStringTag]() { return "Tagged"; }
}
export class NamedLikeAnotherType extends Core {
  get elsewhere() { return "inherited elsewhere"; }
}
export class BelowHarmless extends Harmless {
  more() { return "more"; }
}
export class BelowHarmlessNamedLikeFields extends Harmless {
  get first() { return "from below"; }
}
export class WithFields extends Core {
  own = "own";
  helper() { return this.own; }
}
export class Altered extends Core {
  helper() { return "helper"; }
}
export class Computed extends Core {
  ["fir" + "st"]() { return "computed"; }
}
export class Numbered extends Core {
  0() { return "zero"; }
}
export function Old(given) { return Reflect.construct(Core, [given], Old); }
Old.prototype = Object.create(Core.prototype, { constructor: { value: Old, writable: true, configurable: true }, legacy: { value() { return "legacy"; }, writable: true, configurable: true } });
Object.setPrototypeOf(Old, Core);

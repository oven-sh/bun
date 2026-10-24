import { Core, Made, describe, rename, widthOf, makeOne } from "./core.ts";

export class Heir extends Core {
  constructor(settings) {
    super(settings);
    this.extra = settings.name.length;
  }
  step(n) {
    return super.step(n) + 1000;
  }
}

export class Further extends Heir {
  own = "further";
}

export function anything(value) {
  return value;
}

export function viaUnknownValue(classes, index, settings) {
  const Chosen = classes[index];
  return new Chosen(settings);
}

export function look(core) {
  return [describe(core), Object.keys(core).join(), JSON.stringify(core.settings), core instanceof Core, core.constructor.name];
}

export { Core, Made, describe, rename, widthOf, makeOne };

import { OnlyExtended, sizeOf } from "./core.ts";

export class Small extends OnlyExtended {
  constructor(size) {
    super(size);
    this.more = size * 2;
  }
}

export class Smaller extends Small {}

export function isOne(value) {
  return value instanceof OnlyExtended;
}

export { sizeOf };

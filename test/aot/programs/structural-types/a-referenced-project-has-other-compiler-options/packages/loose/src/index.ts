export const log: string[] = [];

export class Base {
  declare level: number;
}
Object.defineProperty(Base.prototype, "level", {
  set(value: number) {
    log.push("loose: the setter of the base got " + value);
  },
  get() {
    return -1;
  },
});

export class Heir extends Base {
  level = 5;
}

export class Declared {
  first: number | undefined;
  second = 2;
  third: string | undefined;
}

export function make(): Declared {
  return new Declared();
}

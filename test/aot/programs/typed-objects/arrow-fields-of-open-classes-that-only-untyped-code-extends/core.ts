export interface Settings {
  name: string;
  limit?: number;
}

export class Core {
  base: number = 1;
  settings!: Settings;
  update = (value: number): number => {
    this.base += value;
    return this.base;
  };
  emit = (value: number): number => this.base * value;
  load = (): number => this.base + 1;
  self = (): Core => this;
  never = (): number => this.base + 2;
  marked = (): number => this.base + 4;
  later?: () => number;
  free = (value: number): number => value + 1;
  both = (other: Core): number => this.base + other.base;
  waits = async (): Promise<number> => this.base + 3;
  plain = function (this: unknown): string {
    return this === undefined ? "no this" : "a this";
  };
  constructor(base: number, settings: Settings) {
    this.base = base;
    this.settings = settings;
    this.update(0);
  }
  viaThis(): number {
    return this.update(1) + this.emit(2) + this.load();
  }
  readsItsOwn(): (value: number) => number {
    return this.emit;
  }
  replaces(): number {
    this.load = () => -1;
    return this.load();
  }
}

export class Twice {
  value = 1;
  run = (): number => this.value;
  constructor(again: boolean) {
    if (again) this.run = () => this.value + 100;
  }
}

export class Chooses {
  value = 5;
  run: () => number;
  constructor(first: boolean) {
    this.run = first ? () => this.value + 1 : () => this.value + 2;
  }
}

export class Made {
  value = 7;
  run = (): number => this.value;
}

export function callThree(core: Core): number {
  return core.update(1) + core.emit(2) + core.load();
}
export function callBackwards(core: Core): number {
  return core.load() + core.emit(2) + core.update(1);
}
export function readOne(core: Core): (value: number) => number {
  return core.emit;
}
export function readIntoVariable(core: Core): number {
  const emit: (value: number) => number = core.emit;
  const load = core.load;
  return emit(3) + load();
}
export function kinds(core: Core): string {
  return [typeof core.emit, typeof core.never, typeof core.later, typeof core.plain, typeof core.base].join();
}
export function sameTwice(core: Core): boolean {
  return core.emit === core.emit && core.self() === core;
}
export function differ(one: Core, other: Core): boolean {
  return one.emit !== other.emit && one.never !== other.never;
}
export function destructured(core: Core): number {
  const { update, load } = core;
  return update(1) + load();
}
export function spreadOf(core: Core): string {
  const copy = { ...core };
  return Object.keys(copy).join() + " " + copy.emit(2) + " " + (copy.self() === core) + " " + (copy.emit === core.emit);
}
export function spreadWithMore(core: Core): string {
  const copy = { ...core, more: 1, base: 50 };
  return Object.keys(copy).length + " " + copy.emit(2) + " " + copy.base + " " + copy.more;
}
export function assigned(core: Core): string {
  const copy = Object.assign({}, core);
  return Object.keys(copy).join() + " " + copy.load() + " " + (copy.load === core.load);
}
export function listed(core: Core): string {
  return [
    Object.keys(core).join(),
    Object.entries(core)
      .map(([name, value]) => name + ":" + typeof value)
      .join(),
    Object.values(core).filter(value => typeof value === "function").length,
    JSON.stringify(core),
    "emit" in core,
    Object.hasOwn(core, "never"),
    Object.getOwnPropertyNames(core).length,
  ].join(" | ");
}
export function described(core: Core): string {
  const descriptor = Object.getOwnPropertyDescriptor(core, "emit")!;
  return [typeof descriptor.value, descriptor.writable, descriptor.enumerable, descriptor.configurable, "get" in descriptor, descriptor.value === core.emit].join();
}
export function overwritten(core: Core): string {
  core.emit = value => value - 1;
  return core.emit(10) + " " + Object.keys(core).join();
}
export function storesLater(core: Core): number {
  core.later = () => core.base + 9;
  return core.later();
}
export function runOf(value: Twice | Chooses | Made): number {
  return value.run();
}
export function makeOne(): Made {
  return new Made();
}

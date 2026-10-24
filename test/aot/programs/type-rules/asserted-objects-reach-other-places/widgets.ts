export type Setting = boolean | string | number;
export type Listener = () => void;

export class Widget {
  setting: Setting = 0;
  untouched: Setting = 0;
  listener: Listener = () => {};
  #hidden: Setting = 0;
  static latest: Setting = 0;
  constructor(initial: Setting = 0) { this.setting = initial; }
  put(value: Setting): void { this.setting = value; }
  get(): Setting { return this.setting; }
  hide(value: Setting): Setting { this.#hidden = value; return this.#hidden; }
  listen(listener: Listener): Listener { this.listener = listener; return this.listener; }
  static remember(value: Setting): Setting { Widget.latest = value; return Widget.latest; }
}

export class Panel extends Widget {
  constructor(initial: Setting) { super(initial); }
  put(value: Setting): void { super.put(value); }
}

export class Cell {
  private stored: Setting = 0;
  get value(): Setting { return this.stored; }
  set value(next: Setting) { this.stored = next; }
}

export let shared: Setting = 0;
export function share(value: Setting): Setting { shared = value; return shared; }
export const forward = (value: Setting): Setting => share(value);
export function untouched(value: Setting): Setting { return value; }
export function half(n: number): number { return n / 2; }
export async function later(value: unknown): Promise<Setting> { return value as Setting; }
export function last(...values: Setting[]): Setting { return values[values.length - 1]; }
export function* once(value: unknown): Generator<Setting> { yield value as Setting; }
export function same<T>(items: T[]): T[] { return items; }
export function sameAgain<T>(items: T[]): T[] { return same(items); }
export class Taker { take(value: Setting): unknown { return value; } run(value: unknown): unknown { return this.take(value as Setting); } }
export function mix<T extends new (...list: any[]) => Taker>(Base: T) { return class extends Base { take(value: Setting): unknown { return [value][0]; } }; }

function computeX() { return "x computed"; }
function computeY() { return "y computed"; }
function clamp(value: number) { return Math.min(value, 3); }

export class Point {
  get x() { return computeX(); }
  get y() { return computeY(); }
}
export class Settings {
  stored = 0;
  get level() { return this.stored * 10; }
  set level(value: number) { this.stored = clamp(value); }
}
export class Traps {
  get(target: object, key: string) { return "got " + key; }
  has(target: object, key: string) { return key === "key"; }
  ownKeys() { return ["listed"]; }
  getOwnPropertyDescriptor() { return { value: 1, enumerable: true, configurable: true }; }
  deleteProperty() { return true; }
}

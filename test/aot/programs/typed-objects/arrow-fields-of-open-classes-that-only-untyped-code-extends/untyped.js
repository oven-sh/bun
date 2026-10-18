import { Core, Twice, Chooses } from "./core.ts";

export class Heir extends Core {
  constructor(base, settings) {
    super(base, settings ?? { name: "heir" });
    this.own = base + 1;
  }
}
export class Overrides extends Core {
  constructor(base) {
    super(base, { name: "overrides" });
    this.emit = value => 1000 + value + this.base;
    this.mine = () => this.own;
    this.own = 4;
  }
  get never() {
    return () => -5;
  }
  set load(value) {
    throw new Error("a field is defined, not set");
  }
}
export class HeirOfTwice extends Twice {}
export class HeirOfChooses extends Chooses {}

export function callThreeUntyped(core) {
  return core.update(1) + core.emit(2) + core.load();
}
export function readOneUntyped(core) {
  return core.emit;
}
export function lookUntyped(core) {
  const names = [];
  for (const name in core) names.push(name);
  return [names.join(), Object.keys(core).join() === names.join(), JSON.stringify(core), typeof core.never, core.never === core.never];
}
export function anything(value) {
  return value;
}
export function removed(core) {
  const gone = delete core.emit;
  return gone + " " + typeof core.emit + " " + Object.keys(core).join();
}
export function redefined(core) {
  Object.defineProperty(core, "emit", { value: value => value + 1000, writable: false, enumerable: false, configurable: true });
  Object.defineProperty(core, "load", { get: () => () => 77, enumerable: true, configurable: true });
  return core.emit(1) + " " + core.load() + " " + Object.keys(core).join();
}
export function overwrittenUntyped(core) {
  core.emit = value => value - 1;
  core.load = () => 5;
}

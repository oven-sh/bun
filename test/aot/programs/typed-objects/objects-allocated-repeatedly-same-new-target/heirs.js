import { Core } from "./core.ts";
export class Heir extends Core {
  helper() { return "helper"; }
}
export class Other extends Core {
  get label() { return "inherited from Other"; }
  set label(value) {}
}
export function Old(count) { return Reflect.construct(Core, [count], Old); }
Old.prototype = Object.create(Core.prototype, { kind: { value: "first", configurable: true } });
export const second = Object.create(Core.prototype, { kind: { value: "second", configurable: true } });
export const many = [];
for (let i = 0; i < 40; i++) many.push(class extends Core { which() { return i; } });
export const bound = Heir.bind(null);
export const proxied = new Proxy(Heir, {});
export function make(C, count) {
  return new C(count);
}
export function addGetter(object, name, value) {
  Object.defineProperty(object, name, { get() { return value; }, configurable: true });
}

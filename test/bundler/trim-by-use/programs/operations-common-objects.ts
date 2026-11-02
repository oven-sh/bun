class Holder {
  #value = 1;
  static has(object: object) {
    return #value in object;
  }
  get value() {
    return this.#value;
  }
  set value(value: number) {
    this.#value = value;
  }
}
function count() {
  return arguments.length;
}
const holder = new Holder();
holder.value = 2;
const bare = Object.create(null);
console.log(
  holder.value,
  Holder.has(holder),
  (count as any)(1, 2),
  Object.keys(bare).length,
  typeof missing,
  (await Promise.all([1, 2])).join(),
);
declare const missing: unknown;

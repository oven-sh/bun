// `Object.freeze` and `Object.setPrototypeOf` are applied to values whose type is a type parameter.
function seal<T extends object>(value: T): T {
  for (const member of Object.values(value)) {
    if (typeof member === "function") Object.setPrototypeOf(member, null);
  }
  Object.setPrototypeOf(value, null);
  return Object.freeze(value);
}
const clock = seal({ now: () => 1, after: (n: number) => n + 1 });
const box = seal({ value: 5 });
function nounOf(name: string) { return seal({ name, read: () => name.length }); }
const noun = nounOf("four");
console.log(Object.isFrozen(clock), Object.getPrototypeOf(clock), clock.now(), clock.after(2), box.value, Object.isFrozen(box), noun.read(), noun.name, Object.isFrozen(noun));

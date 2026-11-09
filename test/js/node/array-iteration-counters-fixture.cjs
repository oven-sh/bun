// Counters on the two things of the array iteration protocol that a script can replace. Each passes its call on.
// A test copies this file beside the fixture that it spawns. install() starts a count, and remove() ends it and gives it.
const arrayIteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]());
const realIterator = Array.prototype[Symbol.iterator];
const realNext = arrayIteratorPrototype.next;
const apply = Reflect.apply;
let iterations = 0;
exports.install = () => {
  iterations = 0;
  Array.prototype[Symbol.iterator] = function () {
    iterations++;
    return apply(realIterator, this, arguments);
  };
  arrayIteratorPrototype.next = function () {
    iterations++;
    return apply(realNext, this, arguments);
  };
};
exports.remove = () => {
  Array.prototype[Symbol.iterator] = realIterator;
  arrayIteratorPrototype.next = realNext;
  return iterations;
};

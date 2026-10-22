// Definitions and stores by a key cell share one table: an entry filled by one must stay right for the other.
class Base {
  constructor(target) {
    if (target) return target;
  }
}

const store = (object, key, value) => {
  object[key] = value;
};
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function run(label, key, setterInstalled) {
  const setterCalls = [];
  class Keyed extends Base {
    [key] = 1;
  }
  const installSetter = () =>
    Object.defineProperty(Keyed.prototype, key, {
      configurable: true,
      get() {
        return "from the getter";
      },
      set(value) {
        setterCalls.push(value);
      },
    });
  const createBare = () => Reflect.construct(Base, [], Keyed);

  if (setterInstalled === "before") installSetter();
  let ownAfterDefinition = 0;
  for (let i = 0; i < 100; i++) if (hasOwn(new Keyed(), key)) ownAfterDefinition++;
  if (setterInstalled === "after") installSetter();

  let ownAfterStore = 0;
  let lastRead;
  for (let i = 0; i < 100; i++) {
    const object = createBare();
    store(object, key, 2);
    if (hasOwn(object, key)) ownAfterStore++;
    lastRead = object[key];
  }
  console.log(label, "definitions", ownAfterDefinition, "own after store", ownAfterStore, "setter calls", setterCalls.length, "read", lastRead);

  const owner = new Keyed();
  for (let i = 0; i < 100; i++) store(owner, key, 1);
  new Keyed(owner);
  console.log(label, "replaced", owner[key], "setter calls", setterCalls.length);

  const hidden = createBare();
  Object.defineProperty(hidden, key, { value: 0, writable: true, enumerable: false, configurable: true });
  for (let i = 0; i < 100; i++) store(hidden, key, 5);
  const beforeDefinition = Object.getOwnPropertyDescriptor(hidden, key);
  new Keyed(hidden);
  const afterDefinition = Object.getOwnPropertyDescriptor(hidden, key);
  console.log(label, "hidden", beforeDefinition.enumerable, beforeDefinition.value, afterDefinition.enumerable, afterDefinition.value);
}

for (const setterInstalled of ["before", "after", "never"]) {
  run("symbol " + setterInstalled, Symbol("k"), setterInstalled);
  run("string " + setterInstalled, ["built", setterInstalled].join("-"), setterInstalled);
}

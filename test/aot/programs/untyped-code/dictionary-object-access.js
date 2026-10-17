// An object with constant property additions and deletions (dictionary mode) behaves like any other object, whatever was cached in between.
const lines = [];
const say = (...parts) => lines.push(parts.join(" "));
const store = (object, value) => {
  object.count = value;
};
const read = object => object.count;
const readMissing = object => object.missing;
const has = object => "count" in object;
const storeByKey = (object, key, value) => {
  object[key] = value;
};
const readByKey = (object, key) => object[key];
const callIt = object => object.act();
const attempt = action => {
  try {
    return action();
  } catch (error) {
    return error.constructor.name;
  }
};
const use = (object, from, to) => {
  for (let i = from; i < to; i++) object["k" + i] = i;
  for (let i = from; i < to - 10; i++) delete object["k" + i];
};

const registry = { count: 0, act: () => 1 };
let sum = 0;
for (let round = 0; round < 6; round++) {
  use(registry, round * 100, round * 100 + 200);
  for (let i = 0; i < 300; i++) {
    store(registry, i + round);
    sum += read(registry) + callIt(registry) + (has(registry) ? 1 : 0) + (readMissing(registry) === undefined ? 1 : 0);
    storeByKey(registry, i & 1 ? "count" : "other", i);
    sum += readByKey(registry, "count") + readByKey(registry, "other");
  }
  say("round", round, sum, Object.keys(registry).length);
}
delete registry.count;
say("deleted", read(registry), has(registry), readByKey(registry, "count"));
store(registry, 5);
say("stored again", read(registry), has(registry), Object.keys(registry).at(-1));
let seen = 0;
Object.defineProperty(registry, "count", {
  get() {
    return 7;
  },
  set(value) {
    seen = value;
  },
  configurable: true,
});
store(registry, 8);
storeByKey(registry, "count", 9);
say("an accessor", read(registry), readByKey(registry, "count"), seen);
Object.defineProperty(registry, "count", { value: 1, writable: false, configurable: true });
say("read-only", attempt(() => store(registry, 2)), attempt(() => storeByKey(registry, "count", 3)), read(registry));
Object.defineProperty(registry, "count", { value: 4, writable: true });
const heir = Object.create(registry);
store(registry, 6);
say("an heir", read(heir), has(heir), callIt(heir), readMissing(heir));
store(heir, 10);
say("shadowed", read(heir), read(registry));
use(registry, 1000, 1200);
store(registry, 11);
delete heir.count;
say("used again", read(heir), read(registry), Object.keys(registry).length);
Object.setPrototypeOf(registry, { missing: "found" });
say("another prototype", readMissing(registry), readMissing(heir));
Object.freeze(registry);
say("frozen", attempt(() => store(registry, 12)), read(registry), attempt(() => storeByKey(registry, "fresh", 1)));
console.log(lines.join("\n"));

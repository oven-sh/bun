// o[k] = v and o[k] with k cycling over 12 names, on objects that store the property inline and objects that store it out of line.
// A frozen object and an accessor under k take the slow path at the same two sites.
const lines = [];
const names = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu"];

function store(o, k, v) { o[k] = v; }
function read(o, k) { return o[k]; }

function attemptStore(o, k, v) {
  try {
    store(o, k, v);
    return "stored";
  } catch (error) {
    return `${error.constructor.name}: ${error.message}`;
  }
}

function distinct(results) {
  return [...new Set(results)].join(" | ");
}

// An ordinary object has room for a few properties in its cell: the names added first are inline, the later ones are out of line.
function createStartingAt(first) {
  const object = Object.create(Object.prototype);
  for (let i = 0; i < names.length; i++) store(object, names[(first + i) % names.length], 0);
  return object;
}

const objects = names.map((name, first) => createStartingAt(first));

function valueFor(round, object, name) {
  return round * 10000 + object * 100 + name;
}

// Every slot gets a value of its own, so a store that lands in a neighboring slot shows up in a read.
function storeAndReadAll(round, keys) {
  for (let i = 0; i < objects.length; i++) {
    for (let j = 0; j < keys.length; j++) store(objects[i], keys[j], valueFor(round, i, j));
  }
  let wrong = 0;
  for (let i = 0; i < objects.length; i++) {
    for (let j = 0; j < keys.length; j++) {
      if (read(objects[i], keys[j]) !== valueFor(round, i, j)) wrong++;
    }
  }
  return wrong;
}

for (let round = 1; round <= 5; round++) lines.push(`round ${round}: ${storeAndReadAll(round, names)} wrong`);
lines.push(`equal names in other strings: ${storeAndReadAll(6, names.map(name => (name + "!").slice(0, -1)))} wrong`);
for (const object of objects) lines.push(JSON.stringify(object));

const frozen = createStartingAt(3);
for (let round = 0; round < 3; round++) {
  for (const name of names) store(frozen, name, 7);
}
Object.freeze(frozen);
for (let round = 0; round < 3; round++) lines.push(`frozen, round ${round}: ${distinct(names.map(name => attemptStore(frozen, name, 8)))}`);
lines.push(`frozen, a new name: ${attemptStore(frozen, "nu", 8)}`);
lines.push(`frozen reads: ${distinct(names.map(name => read(frozen, name)))}, ${JSON.stringify(frozen)}`);

const calls = [];
const withAccessors = createStartingAt(0);
for (let round = 0; round < 3; round++) {
  for (const name of names) store(withAccessors, name, 1);
}
// "beta" was added second and "lambda" second to last.
for (const name of ["beta", "lambda"]) {
  let current = `initial ${name}`;
  Object.defineProperty(withAccessors, name, {
    get() { calls.push(`get ${name}`); return current; },
    set(value) { calls.push(`set ${name} on ${this === withAccessors ? "the holder" : "another object"}`); current = value; },
    enumerable: true,
    configurable: true,
  });
}
for (let round = 0; round < 3; round++) {
  lines.push(`accessors, round ${round}: ${names.map(name => read(withAccessors, name)).join()}`);
  for (let j = 0; j < names.length; j++) store(withAccessors, names[j], valueFor(round, 0, j));
}
lines.push(`accessors: ${names.map(name => read(withAccessors, name)).join()}`);
lines.push(`${calls.length} calls: ${distinct(calls)}`);

calls.length = 0;
const inheriting = Object.create(withAccessors);
for (let round = 0; round < 3; round++) {
  for (let j = 0; j < names.length; j++) store(inheriting, names[j], valueFor(round, 1, j));
}
lines.push(`inherited setters: own ${Object.keys(inheriting).join()}, reads ${names.map(name => read(inheriting, name)).join()}`);
lines.push(`${calls.length} calls: ${distinct(calls)}`);

for (const name of ["beta", "lambda"]) Object.defineProperty(withAccessors, name, { get() { return `only a getter for ${name}`; }, set: undefined });
for (let round = 0; round < 3; round++) lines.push(`getter without setter, round ${round}: ${names.map(name => attemptStore(withAccessors, name, round)).join()}`);
lines.push(names.map(name => read(withAccessors, name)).join());

for (const name of ["beta", "lambda"]) Object.defineProperty(withAccessors, name, { value: 0, writable: true });
for (let round = 0; round < 3; round++) {
  for (let j = 0; j < names.length; j++) store(withAccessors, names[j], valueFor(round, 2, j));
}
lines.push(`values again: ${JSON.stringify(withAccessors)}`);

console.log(lines.join("\n"));

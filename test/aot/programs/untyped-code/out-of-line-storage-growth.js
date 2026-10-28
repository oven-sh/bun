// Out-of-line property storage is created and doubled four times while objects, functions and arrays get 1 to 70 properties, by name and by computed key, also with a collection after every addition.
import "../jsc-shell-functions.ts";

const propertyCount = 70;
const keys = Array.from({ length: propertyCount }, (_, index) => "p" + index);

const storesByName = [
  (object, value) => (object.p0 = value),
  (object, value) => (object.p1 = value),
  (object, value) => (object.p2 = value),
  (object, value) => (object.p3 = value),
  (object, value) => (object.p4 = value),
  (object, value) => (object.p5 = value),
  (object, value) => (object.p6 = value),
  (object, value) => (object.p7 = value),
  (object, value) => (object.p8 = value),
  (object, value) => (object.p9 = value),
  (object, value) => (object.p10 = value),
  (object, value) => (object.p11 = value),
  (object, value) => (object.p12 = value),
  (object, value) => (object.p13 = value),
  (object, value) => (object.p14 = value),
  (object, value) => (object.p15 = value),
  (object, value) => (object.p16 = value),
  (object, value) => (object.p17 = value),
  (object, value) => (object.p18 = value),
  (object, value) => (object.p19 = value),
  (object, value) => (object.p20 = value),
  (object, value) => (object.p21 = value),
  (object, value) => (object.p22 = value),
  (object, value) => (object.p23 = value),
  (object, value) => (object.p24 = value),
  (object, value) => (object.p25 = value),
  (object, value) => (object.p26 = value),
  (object, value) => (object.p27 = value),
  (object, value) => (object.p28 = value),
  (object, value) => (object.p29 = value),
  (object, value) => (object.p30 = value),
  (object, value) => (object.p31 = value),
  (object, value) => (object.p32 = value),
  (object, value) => (object.p33 = value),
  (object, value) => (object.p34 = value),
  (object, value) => (object.p35 = value),
  (object, value) => (object.p36 = value),
  (object, value) => (object.p37 = value),
  (object, value) => (object.p38 = value),
  (object, value) => (object.p39 = value),
  (object, value) => (object.p40 = value),
  (object, value) => (object.p41 = value),
  (object, value) => (object.p42 = value),
  (object, value) => (object.p43 = value),
  (object, value) => (object.p44 = value),
  (object, value) => (object.p45 = value),
  (object, value) => (object.p46 = value),
  (object, value) => (object.p47 = value),
  (object, value) => (object.p48 = value),
  (object, value) => (object.p49 = value),
  (object, value) => (object.p50 = value),
  (object, value) => (object.p51 = value),
  (object, value) => (object.p52 = value),
  (object, value) => (object.p53 = value),
  (object, value) => (object.p54 = value),
  (object, value) => (object.p55 = value),
  (object, value) => (object.p56 = value),
  (object, value) => (object.p57 = value),
  (object, value) => (object.p58 = value),
  (object, value) => (object.p59 = value),
  (object, value) => (object.p60 = value),
  (object, value) => (object.p61 = value),
  (object, value) => (object.p62 = value),
  (object, value) => (object.p63 = value),
  (object, value) => (object.p64 = value),
  (object, value) => (object.p65 = value),
  (object, value) => (object.p66 = value),
  (object, value) => (object.p67 = value),
  (object, value) => (object.p68 = value),
  (object, value) => (object.p69 = value),
];

const readsByName = [
  object => object.p0,
  object => object.p1,
  object => object.p2,
  object => object.p3,
  object => object.p4,
  object => object.p5,
  object => object.p6,
  object => object.p7,
  object => object.p8,
  object => object.p9,
  object => object.p10,
  object => object.p11,
  object => object.p12,
  object => object.p13,
  object => object.p14,
  object => object.p15,
  object => object.p16,
  object => object.p17,
  object => object.p18,
  object => object.p19,
  object => object.p20,
  object => object.p21,
  object => object.p22,
  object => object.p23,
  object => object.p24,
  object => object.p25,
  object => object.p26,
  object => object.p27,
  object => object.p28,
  object => object.p29,
  object => object.p30,
  object => object.p31,
  object => object.p32,
  object => object.p33,
  object => object.p34,
  object => object.p35,
  object => object.p36,
  object => object.p37,
  object => object.p38,
  object => object.p39,
  object => object.p40,
  object => object.p41,
  object => object.p42,
  object => object.p43,
  object => object.p44,
  object => object.p45,
  object => object.p46,
  object => object.p47,
  object => object.p48,
  object => object.p49,
  object => object.p50,
  object => object.p51,
  object => object.p52,
  object => object.p53,
  object => object.p54,
  object => object.p55,
  object => object.p56,
  object => object.p57,
  object => object.p58,
  object => object.p59,
  object => object.p60,
  object => object.p61,
  object => object.p62,
  object => object.p63,
  object => object.p64,
  object => object.p65,
  object => object.p66,
  object => object.p67,
  object => object.p68,
  object => object.p69,
];

const storeKinds = [
  { label: "by name", store: (object, index, value) => storesByName[index](object, value) },
  { label: "by key", store: (object, index, value) => (object[keys[index]] = value) },
];

function createValue(seed) {
  switch (seed % 4) {
    case 0:
      return seed;
    case 1:
      return seed + 0.5;
    case 2:
      return "text " + seed;
    default:
      return { seed };
  }
}

function isValue(value, seed) {
  switch (seed % 4) {
    case 0:
      return value === seed;
    case 1:
      return value === seed + 0.5;
    case 2:
      return value === "text " + seed;
    default:
      return typeof value === "object" && value !== null && value.seed === seed;
  }
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
}

function add(a, b) {
  return a + b;
}

const inspectFields = object => [object.first, object.second, object.third].join();
const inspectFunction = callee => [typeof callee, callee.name, callee.length, callee(2, 3), typeof callee.prototype].join();
const inspectClass = callee => [callee.name, callee.length, new callee(2, 3).sum, typeof callee.prototype].join();
const inspectElements = object =>
  Object.keys(object)
    .filter(key => /^\d+$/.test(key))
    .map(key => key + "=" + object[key])
    .join() + " length=" + object.length;

function pushEveryFifth(array, index) {
  if (index % 5 === 4) array.push(index);
}

function setEveryNinthElement(object, index) {
  if (index % 9 === 8) object[index] = index;
}

// The kinds from "array" on have an indexing header, or get one, so their storage never grows on the fast path.
const kinds = [
  { label: "object literal", create: () => ({}), inspect: inspectFields },
  { label: "object literal with properties", create: () => ({ first: 1, second: "two", third: 3.5 }), inspect: inspectFields },
  { label: "parsed object", create: () => JSON.parse('{"first":1}'), inspect: inspectFields },
  { label: "object without prototype", create: () => Object.create(null), inspect: inspectFields },
  { label: "class instance", create: () => new Point(1, 2), inspect: point => [point.x, point.y, point.sum()].join() },
  { label: "function", create: () => function multiply(a, b) { return a * b; }, inspect: inspectFunction },
  { label: "arrow function", create: () => (a, b) => a - b, inspect: inspectFunction },
  { label: "bound function", create: () => add.bind(null, 1), inspect: inspectFunction },
  { label: "class", create: () => class Pair { constructor(a, b) { this.sum = a + b; } }, inspect: inspectClass },
  { label: "array", create: () => [1, 2, 3], inspect: inspectElements, touch: pushEveryFifth },
  { label: "array of doubles", create: () => [0.5, 1.5], inspect: inspectElements, touch: pushEveryFifth },
  { label: "empty array", create: () => [], inspect: inspectElements },
  { label: "object with elements", create: () => ({ 0: "zero", 1: "one" }), inspect: inspectElements },
  { label: "object that gets elements", create: () => JSON.parse("{}"), inspect: inspectElements, touch: setEveryNinthElement },
  { label: "typed array", create: () => new Uint8Array([7, 8, 9]), inspect: inspectElements },
];

function addProperty(kind, storeKind, object, index, seed) {
  storeKind.store(object, index, createValue(seed + index));
  kind.touch?.(object, index);
}

function inspectWithoutProperties(kind, count) {
  const object = kind.create();
  for (let index = 0; index < count; index++) kind.touch?.(object, index);
  return kind.inspect(object);
}

function verify(kind, storeKind, object, count, seed) {
  const label = `${kind.label} ${storeKind.label} with ${count} properties`;
  for (let index = 0; index < propertyCount; index++) {
    const byName = readsByName[index](object);
    const byKey = object[keys[index]];
    const isPresent = index < count;
    const isCorrect = isPresent ? isValue(byName, seed + index) : byName === undefined;
    if (!isCorrect || byName !== byKey || Object.hasOwn(object, keys[index]) !== isPresent)
      throw new Error(`${label}: property ${index} is ${String(byName)} by name and ${String(byKey)} by key`);
  }
  const addedKeys = Object.keys(object).filter(key => key.startsWith("p"));
  if (addedKeys.join() !== keys.slice(0, count).join()) throw new Error(`${label}: the keys are ${addedKeys.join()}`);
  const inspected = kind.inspect(object);
  const expected = inspectWithoutProperties(kind, count);
  if (inspected !== expected) throw new Error(`${label}: ${inspected} instead of ${expected}`);
  return inspected;
}

for (const kind of kinds) {
  let inspected = "";
  for (const storeKind of storeKinds) {
    for (let count = 1; count <= propertyCount; count++) {
      const seed = count * 1000;
      const object = kind.create();
      for (let index = 0; index < count; index++) addProperty(kind, storeKind, object, index, seed);
      inspected = verify(kind, storeKind, object, count, seed);
    }
  }
  console.log(`${kind.label}: ${inspected}`);
}

const survivorSeed = 5;
const survivors = kinds.flatMap(kind => storeKinds.map(storeKind => ({ kind, storeKind, object: kind.create() })));
gc();
for (let index = 0; index < propertyCount; index++) {
  for (const { kind, storeKind, object } of survivors) addProperty(kind, storeKind, object, index, survivorSeed);
  if (index % 8 === 7) gc();
  else edenGC();
  for (const { kind, storeKind, object } of survivors) verify(kind, storeKind, object, index + 1, survivorSeed);
}
console.log(`${survivors.length} objects have every property after ${propertyCount} additions with a collection after each`);

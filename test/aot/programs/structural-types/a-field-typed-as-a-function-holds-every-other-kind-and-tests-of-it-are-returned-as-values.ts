class Point {
  x = 1;
}

class Bag {
  integer = 1;
  fraction = 0.5;
  text = "t";
  flag = true;
  point = new Point();
  run: () => number = () => 1;
  list: number[] = [1];
  nothing: undefined = undefined;
  none: null = null;
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

function isUndefined(bag: Bag): boolean {
  return bag.run === undefined;
}

function isNull(bag: Bag): boolean {
  return bag.run === null;
}

function isNullish(bag: Bag): boolean {
  return bag.run == null;
}

function kindIsUndefined(bag: Bag): boolean {
  return typeof bag.run === "undefined";
}

function kindIsNumber(bag: Bag): boolean {
  return typeof bag.run === "number";
}

function kindIsString(bag: Bag): boolean {
  return typeof bag.run === "string";
}

function kindIsBoolean(bag: Bag): boolean {
  return typeof bag.run === "boolean";
}

function kindIsObject(bag: Bag): boolean {
  return typeof bag.run === "object";
}

function kindIsFunction(bag: Bag): boolean {
  return typeof bag.run === "function";
}

function isFalsy(bag: Bag): boolean {
  return !bag.run;
}

function isItself(bag: Bag): boolean {
  return bag.run === bag.run;
}

function use(bag: Bag): string {
  try {
    return String(bag.run());
  } catch (error) {
    return "threw " + (error instanceof TypeError);
  }
}

const honest = new Bag();
let warm = 0;
for (let i = 0; i < 2000; i++) {
  if (isUndefined(honest)) warm++;
  if (isNull(honest)) warm++;
  if (isNullish(honest)) warm++;
  if (kindIsUndefined(honest)) warm++;
  if (kindIsNumber(honest)) warm++;
  if (kindIsString(honest)) warm++;
  if (kindIsBoolean(honest)) warm++;
  if (kindIsObject(honest)) warm++;
  if (kindIsFunction(honest)) warm++;
  if (isFalsy(honest)) warm++;
  if (isItself(honest)) warm++;
  warm += use(honest).length;
}
console.log("2000 honest rounds: " + warm);

function chosen(): keyof Bag {
  return process.argv.length > 0 ? "run" : "nothing";
}

const key = chosen();
const values: [string, Bag[keyof Bag]][] = [
  ["an integer", 7],
  ["a fraction", 2.5],
  ["zero", 0],
  ["not a number", NaN],
  ["a text", "text"],
  ["an empty text", ""],
  ["true", true],
  ["false", false],
  ["a point", new Point()],
  ["a function", () => 2],
  ["a list", [1, 2]],
  ["undefined", undefined],
  ["null", null],
];

for (const [label, value] of values) {
  const bag = new Bag();
  set(bag, key, value);
  let line = label + ": " + typeof bag.run + " |";
  if (isUndefined(bag)) line += " isUndefined";
  if (isNull(bag)) line += " isNull";
  if (isNullish(bag)) line += " isNullish";
  if (kindIsUndefined(bag)) line += " kindIsUndefined";
  if (kindIsNumber(bag)) line += " kindIsNumber";
  if (kindIsString(bag)) line += " kindIsString";
  if (kindIsBoolean(bag)) line += " kindIsBoolean";
  if (kindIsObject(bag)) line += " kindIsObject";
  if (kindIsFunction(bag)) line += " kindIsFunction";
  if (isFalsy(bag)) line += " isFalsy";
  if (isItself(bag)) line += " isItself";
  console.log(line + " | " + use(bag) + " | " + Object.keys(bag).length);
}

export {};

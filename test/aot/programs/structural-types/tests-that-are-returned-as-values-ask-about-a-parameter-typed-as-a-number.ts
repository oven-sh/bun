type Tested = number;

function isUndefined(x: Tested): boolean {
  return x === undefined;
}

function isNotUndefined(x: Tested): boolean {
  return x !== undefined;
}

function isNull(x: Tested): boolean {
  return x === null;
}

function isNullish(x: Tested): boolean {
  return x == null;
}

function kindIsUndefined(x: Tested): boolean {
  return typeof x === "undefined";
}

function kindIsNumber(x: Tested): boolean {
  return typeof x === "number";
}

function kindIsNotNumber(x: Tested): boolean {
  return typeof x !== "number";
}

function kindIsString(x: Tested): boolean {
  return typeof x === "string";
}

function kindIsNotString(x: Tested): boolean {
  return typeof x !== "string";
}

function kindIsBoolean(x: Tested): boolean {
  return typeof x === "boolean";
}

function kindIsObject(x: Tested): boolean {
  return typeof x === "object";
}

function kindIsNotObject(x: Tested): boolean {
  return typeof x !== "object";
}

function kindIsFunction(x: Tested): boolean {
  return typeof x === "function";
}

function isFalsy(x: Tested): boolean {
  return !x;
}

function isTruthy(x: Tested): boolean {
  return !!x;
}

function isItself(x: Tested): boolean {
  return x === x;
}

function isAList(x: Tested): boolean {
  return Array.isArray(x);
}

const honest: Tested = 7;
let warm = 0;
for (let i = 0; i < 2000; i++) {
  if (isUndefined(honest)) warm++;
  if (isNotUndefined(honest)) warm++;
  if (isNull(honest)) warm++;
  if (isNullish(honest)) warm++;
  if (kindIsUndefined(honest)) warm++;
  if (kindIsNumber(honest)) warm++;
  if (kindIsNotNumber(honest)) warm++;
  if (kindIsString(honest)) warm++;
  if (kindIsNotString(honest)) warm++;
  if (kindIsBoolean(honest)) warm++;
  if (kindIsObject(honest)) warm++;
  if (kindIsNotObject(honest)) warm++;
  if (kindIsFunction(honest)) warm++;
  if (isFalsy(honest)) warm++;
  if (isTruthy(honest)) warm++;
  if (isItself(honest)) warm++;
  if (isAList(honest)) warm++;
}
console.log("2000 honest rounds: " + warm);

const values: Tested[] = [honest];
const wide: unknown[] = values;
wide.push(undefined, null, 0, -0, NaN, 5, 1.5, "", "text", false, true, {}, [], () => 1, 10n, Symbol.iterator);
const labels = ["honest", "undefined", "null", "zero", "minus zero", "not a number", "five", "one and a half", "an empty string", "a text", "false", "true", "an object", "a list", "a function", "a big integer", "a symbol", "past the end"];

for (let i = 0; i < labels.length; i++) {
  const x = values[i];
  let line = labels[i] + ":";
  if (isUndefined(x)) line += " isUndefined";
  if (isNotUndefined(x)) line += " isNotUndefined";
  if (isNull(x)) line += " isNull";
  if (isNullish(x)) line += " isNullish";
  if (kindIsUndefined(x)) line += " kindIsUndefined";
  if (kindIsNumber(x)) line += " kindIsNumber";
  if (kindIsNotNumber(x)) line += " kindIsNotNumber";
  if (kindIsString(x)) line += " kindIsString";
  if (kindIsNotString(x)) line += " kindIsNotString";
  if (kindIsBoolean(x)) line += " kindIsBoolean";
  if (kindIsObject(x)) line += " kindIsObject";
  if (kindIsNotObject(x)) line += " kindIsNotObject";
  if (kindIsFunction(x)) line += " kindIsFunction";
  if (isFalsy(x)) line += " isFalsy";
  if (isTruthy(x)) line += " isTruthy";
  if (isItself(x)) line += " isItself";
  if (isAList(x)) line += " isAList";
  console.log(line);
}

export {};

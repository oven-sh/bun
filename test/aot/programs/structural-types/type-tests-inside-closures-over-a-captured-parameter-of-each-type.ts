function ask(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "threw";
  }
}
class Point {
  x = 1;
}
function tests(read: () => unknown): string {
  return ask(() => typeof read());
}
function ofNumber(value: number): string {
  return [
    ask(() => typeof value === "object"),
    ask(() => typeof value === "function"),
    ask(() => typeof value === "string"),
    ask(() => typeof value === "undefined"),
    ask(() => typeof value === "boolean"),
    ask(() => typeof value === "bigint"),
    ask(() => typeof value === "number"),
    ask(() => value === undefined),
    ask(() => value === null),
    ask(() => value == null),
    ask(() => (value ? "truthy" : "falsy")),
    ask(() => !value),
    tests(() => value),
  ].join(" ");
}
function ofString(value: string): string {
  return [
    ask(() => typeof value === "object"),
    ask(() => typeof value === "function"),
    ask(() => typeof value === "string"),
    ask(() => typeof value === "undefined"),
    ask(() => typeof value === "boolean"),
    ask(() => typeof value === "bigint"),
    ask(() => typeof value === "number"),
    ask(() => value === undefined),
    ask(() => value === null),
    ask(() => value == null),
    ask(() => (value ? "truthy" : "falsy")),
    ask(() => !value),
    tests(() => value),
  ].join(" ");
}
function ofBoolean(value: boolean): string {
  return [
    ask(() => typeof value === "object"),
    ask(() => typeof value === "function"),
    ask(() => typeof value === "string"),
    ask(() => typeof value === "undefined"),
    ask(() => typeof value === "boolean"),
    ask(() => typeof value === "bigint"),
    ask(() => typeof value === "number"),
    ask(() => value === undefined),
    ask(() => value === null),
    ask(() => value == null),
    ask(() => (value ? "truthy" : "falsy")),
    ask(() => !value),
    tests(() => value),
  ].join(" ");
}
function ofPoint(value: Point): string {
  return [
    ask(() => typeof value === "object"),
    ask(() => typeof value === "function"),
    ask(() => typeof value === "string"),
    ask(() => typeof value === "undefined"),
    ask(() => typeof value === "boolean"),
    ask(() => typeof value === "bigint"),
    ask(() => typeof value === "number"),
    ask(() => value === undefined),
    ask(() => value === null),
    ask(() => value == null),
    ask(() => (value ? "truthy" : "falsy")),
    ask(() => !value),
    tests(() => value),
  ].join(" ");
}
const arrivals: unknown[] = [1, "ab", true, new Point(), {}, () => 1, undefined, 10n, null, "", [], 0, NaN];
const numbers: number[] = [];
const strings: string[] = [];
const booleans: boolean[] = [];
const points: Point[] = [];
for (const list of [numbers, strings, booleans, points]) {
  const wide: unknown[] = list;
  wide.push(...arrivals);
}
for (let index = 0; index < arrivals.length; index++) {
  console.log("number " + index + ": " + ofNumber(numbers[index]));
  console.log("string " + index + ": " + ofString(strings[index]));
  console.log("boolean " + index + ": " + ofBoolean(booleans[index]));
  console.log("point " + index + ": " + ofPoint(points[index]));
}

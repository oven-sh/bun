// A type predicate and an assertion signature narrow where the function is called. Beside each stands one that is never called and only lends its type to a variable that holds another function.
function isText(value: unknown): value is string {
  return typeof value === "string";
}
function assertNumber(value: unknown): asserts value is number {
  if (typeof value !== "number") throw new TypeError("not a number");
}
function isTextUnused(value: unknown): value is string {
  return false;
}
function assertUnused(value: unknown): asserts value is number {}

const check: typeof isTextUnused = (value): value is string => typeof value === "string" && value.length > 0;
const assert: typeof assertUnused = value => {
  if (typeof value !== "number") throw new RangeError("no number");
};

function run(value: unknown): string {
  if (isText(value)) return value.toUpperCase();
  if (check(value)) return value.toLowerCase();
  assertNumber(value);
  const sum = value + 1;
  assert(value);
  return String(sum + value);
}
console.log(run("a"), run(1));
try {
  run(null);
} catch (error) {
  console.log((error as Error).message);
}

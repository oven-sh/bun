// The return types of these functions name things that exist only inside their bodies: a local class, a local enum, an object with a method, a closure, a tuple from a destructuring. Nobody calls the functions; the types are used on values that are made elsewhere.
function makesLocalClass() {
  class Local {
    size = 3;
    grow() {
      return this.size + 1;
    }
  }
  return new Local();
}
function makesLocalEnum() {
  enum Direction {
    Up = "up",
    Down = "down",
  }
  return Direction.Up as Direction;
}
function makesClosure() {
  let count = 0;
  return { next: () => ++count, reset: (to: number) => void (count = to) };
}
function makesTuple() {
  const [first, ...rest] = [1, "two", true] as [number, string, boolean];
  return { first, rest };
}
function inferredPredicate(value: unknown) {
  return typeof value === "string";
}

const local: ReturnType<typeof makesLocalClass> = { size: 5, grow: () => 6 };
const direction = "down" as ReturnType<typeof makesLocalEnum>;
const closure: ReturnType<typeof makesClosure> = { next: () => 1, reset: () => {} };
const tuple: ReturnType<typeof makesTuple> = { first: 2, rest: ["three", false] };
const predicate: typeof inferredPredicate = (value): value is string => typeof value === "string";

const unknown: unknown = "text";
console.log(local.size + local.grow(), direction.toUpperCase(), closure.next() + 1, closure.reset(2), tuple.first + 1, tuple.rest[0].length, !tuple.rest[1]);
if (predicate(unknown)) console.log(unknown.length);

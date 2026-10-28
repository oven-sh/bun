// The other side of methods-with-a-typed-this-are-no-constructors.ts: a function declaration whose first statements store to `this` is a constructor with a layout of its own, which has the fields it stores and no other: a field of the declared type that it does not store is absent from what it makes, whatever the literals of the type do.
// IR+ ^layout L\d+ .*name="Half" .*\{name="first" declared=
// IR- ^layout L\d+ .*name="Half" .*\{name="second" declared=
// VALIDATED compiles
interface Pair { first: number; second: number }
function Half(this: Pair, first: number) { this.first = first }
const literal = (first: number, second: number): Pair => ({ first, second })
const sum = (pair: Pair) => pair.first + (pair.second === undefined ? 100 : pair.second)
const half: any = Half
const made: Pair = new half(1)
console.log(sum(made), sum(literal(2, 3)), Object.keys(made).join(), "second" in made, made instanceof half)
made.second = 4
console.log(sum(made), Object.keys(made).join())

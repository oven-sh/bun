// The other side of methods-with-a-typed-this-are-no-constructors.ts: a function declaration whose first statements store to `this` is a constructor of its type for callers nobody sees, so a field it does not store may be absent, whatever the literals of the type do.
// IR+ field "first" number flags (20[4-9]\d|2[1-9]\d\d|3\d\d\d|40\d\d) 
// IR- field "second" number flags (20[4-9]\d|2[1-9]\d\d|3\d\d\d|40\d\d) 
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

// Reads of `const` and `let` variables in their temporal dead zone throw when the initializer is not a constant expression.
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function readConst(): number { return tooEarly }
console.log(attempt(readConst), attempt(() => tooEarlyLet))
// Not a constant expression: those are compile-time constants, see type-rules/constant-tdz.
const tooEarly: number = Math.abs(-5)
let tooEarlyLet: string = "x"
console.log(readConst(), tooEarlyLet)

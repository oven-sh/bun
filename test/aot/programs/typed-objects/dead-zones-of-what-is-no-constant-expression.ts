// Typed objects: dead zones of what is no constant expression.
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function readConst(): number { return tooEarly }
console.log(attempt(readConst), attempt(() => tooEarlyLet))
// Not a constant expression: those are compile-time constants, see type-rules/constant-dead-zone.
const tooEarly: number = Math.abs(-5)
let tooEarlyLet: string = "x"
console.log(readConst(), tooEarlyLet)

// A numeric enum is tested as `number`, because TypeScript lets any number into it: fractions, NaN, -0 and numbers beyond 32 bits pass and are stored as they are.
enum NodeFlags { None = 0, Let = 1 << 0, Const = 1 << 1, Top = 1 << 30 }
enum Small { A = 1, B = 2, C = 4 }
function rule(label: string, f: () => unknown) { try { console.log(label + ": no error", f()) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }
function has(f: NodeFlags, bit: NodeFlags): boolean { return (f & bit) !== 0 }
let walk: Small = Small.C
rule("a fraction, compound assignment to a variable", () => { walk += 0.5; return walk })
console.log(walk)
rule("a fraction, annotated constant", () => { const fraction: Small = Small.A / 2; return fraction })
rule("NaN", () => { const notANumber: Small = Small.A * NaN; return notANumber })
const holder: { s: Small } = { s: Small.C }
rule("-0 in a field", () => { holder.s = -0 * Small.A; return Object.is(holder.s, -0) })
rule("beyond 32 bits in a field", () => { holder.s = 2 ** 40 * Small.B; return holder.s })
rule("beyond 32 bits in a field of a literal", () => { const made: { s: Small } = { s: 2 ** 31 * Small.A }; return made.s })
console.log(holder.s)
const list: NodeFlags[] = [NodeFlags.Let, NodeFlags.Top * 2]
console.log(list.join())
rule("beyond 32 bits, element read", () => list[1])
rule("beyond 32 bits, element read into the enum", () => { const f: NodeFlags = list[1]; return f })
rule("beyond 32 bits, parameter of a callback", () => list.map(f => has(f, NodeFlags.Const)).join())
rule("beyond 32 bits, argument", () => has(NodeFlags.Top * 4, NodeFlags.Const))

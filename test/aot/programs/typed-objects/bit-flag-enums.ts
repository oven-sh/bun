// Bit-flag enums: combinations of flags are outside the set, and outside the range, of the declared members.
enum NodeFlags { None = 0, Let = 1 << 0, Const = 1 << 1, Using = 1 << 2, Nested = 1 << 3, Synthesized = 1 << 4, BlockScoped = Let | Const | Using, HasError = 1 << 16, Top = 1 << 30 }
enum Small { A = 1, B = 2, C = 4 }
const enum Mode { Read = 1, Write = 2, Exec = 4, All = Read | Write | Exec }
enum Signed { Low = 1, High = 1 << 31 }
interface Flagged { flags: NodeFlags; small: Small; extra?: Small }
function has(f: NodeFlags, bit: NodeFlags): boolean { return (f & bit) !== 0 }
function names(f: Small): string { const out: string[] = []; if (f & Small.A) out.push("A"); if (f & Small.B) out.push("B"); if (f & Small.C) out.push("C"); return out.join("|") || "none" }

// 7 is above every member of Small; 0 is below.
const all: Small = Small.A | Small.B | Small.C
const none: Small = all & ~all
console.log(all, none, names(all), names(none), names(Small.A | Small.C), Small[all], Small[Small.B], typeof all)

// In fields: |=, &= ~, ^=, shifts; read back, compared, printed.
const n: Flagged = { flags: NodeFlags.None, small: Small.A }
n.flags |= NodeFlags.Let; n.flags |= NodeFlags.HasError; n.flags |= NodeFlags.Top; n.small |= Small.C
console.log(n.flags, n.small, has(n.flags, NodeFlags.BlockScoped), has(n.flags, NodeFlags.Const), has(n.flags, NodeFlags.Top), JSON.stringify(n))
n.flags &= ~NodeFlags.Let; n.small ^= Small.A | Small.B; n.small <<= 4
console.log(n.flags, n.small, has(n.flags, NodeFlags.BlockScoped), n.flags === (NodeFlags.HasError | NodeFlags.Top), +n.small === 96)
n.extra = n.small | Small.A
n.extra |= 1024
console.log(n.extra, "extra" in n, Object.keys(n).join())

// The complement is negative; so is the top bit; >>> makes it large.
const inverted: NodeFlags = ~NodeFlags.BlockScoped
const notNone: Small = ~Small.A
const high: Signed = Signed.High, both: Signed = Signed.High | Signed.Low
const m: Flagged = { flags: inverted, small: notNone }
console.log(inverted, notNone, high, both, m.flags, m.small, m.flags & NodeFlags.Nested, m.flags & NodeFlags.Let, m.flags >>> 0, both >>> 0, high >>> 31, high >> 31, -high, Signed[high], Signed.High < 0)
m.flags = ~m.flags; m.small = ~m.small
console.log(m.flags, m.small, m.flags === NodeFlags.BlockScoped, m.small === Small.A)

// Arithmetic on enum values gives numbers that go back into enum places.
let walk: Small = Small.A
const walked: number[] = []
for (let i = 0; i < 6; i++) { walked.push(walk); walk = walk * 2 }
console.log(walked.join(), walk, walk / 3 > 21, Small[walk], walk + 0.5)
const holder: { s: Small } = { s: Small.C }
holder.s++; holder.s++; holder.s += 100; holder.s--
console.log(holder.s, holder.s % 7, -holder.s, holder.s * 1e10)
const computed: Small = Math.max(Small.A, Small.C) * 1000
const slots: { s: Small }[] = [{ s: computed }, { s: -computed }, { s: 2 ** 30 * Small.A }, { s: -(2 ** 30) * Small.B }]
console.log(slots.map(x => String(x.s)).join(), Small.A / 2, Small.A * NaN, Object.is(-0 * Small.A, -0), 2 ** 40 * Small.B)

// Arrays, maps, switch, parameters with defaults.
const list: NodeFlags[] = [NodeFlags.Let, NodeFlags.Let | NodeFlags.Const, NodeFlags.BlockScoped, ~0, NodeFlags.Top | NodeFlags.HasError]
console.log(list.join(), list.map(f => has(f, NodeFlags.Const)).join(), list.reduce((x, y) => x | y, NodeFlags.None), list.indexOf(NodeFlags.BlockScoped), list.includes(NodeFlags.Let | NodeFlags.Const))
function classify(f: Small = Small.B): string { switch (f) { case Small.A: return "a"; case Small.B: return "b"; case Small.C: return "c"; case Small.A | Small.B: return "ab"; default: return "other " + f } }
console.log(classify(), classify(Small.A), classify(Small.A | Small.B), classify(all), classify(none), classify(Small.C << 1), classify(undefined))
const counts = new Map<Small, number>()
for (const f of [all, Small.A, all, none, Small.A + Small.B + Small.C]) counts.set(f, (counts.get(f) ?? 0) + 1)
console.log([...counts].map(e => e.join(":")).join())

// const enums fold to the same numbers.
let mode: Mode = Mode.Read
mode |= Mode.Exec
const perm: { mode: Mode } = { mode: Mode.All & ~Mode.Write }
console.log(mode, perm.mode, mode === perm.mode, Mode.All, (mode | Mode.Write) === Mode.All, ~Mode.All, perm.mode << 29, perm.mode << 30)

// The enum object: reverse mapping only for members; it is an ordinary object.
console.log(Object.keys(Small).join(), Small[1], Small[7], Small["A"], NodeFlags[7], NodeFlags[NodeFlags.Let | NodeFlags.Const], NodeFlags[0], Object.keys(Signed).join(), JSON.stringify(Small))

// The pattern of a compiler: flags computed from children, tested in a hot loop.
interface Tn { flags: NodeFlags; kids: Tn[] }
function tn(flags: NodeFlags, ...kids: Tn[]): Tn { let f = flags; for (const k of kids) f |= k.flags & ~NodeFlags.Nested; return { flags: f, kids } }
const tree = tn(NodeFlags.Nested, tn(NodeFlags.Let, tn(NodeFlags.HasError | NodeFlags.Nested)), tn(NodeFlags.Const | NodeFlags.Top), tn(NodeFlags.None))
function count(t: Tn, bit: NodeFlags): number { let c = (t.flags & bit) === bit ? 1 : 0; for (const k of t.kids) c += count(k, bit); return c }
console.log(tree.flags, count(tree, NodeFlags.HasError), count(tree, NodeFlags.Nested), count(tree, NodeFlags.Let | NodeFlags.HasError), count(tree, NodeFlags.None), count(tree, NodeFlags.Top))

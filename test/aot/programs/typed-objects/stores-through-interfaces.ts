// Typed stores to objects that cannot take them because they are frozen, sealed or non-extensible, and the order of receiver, right-hand side and store.
interface Settings { volume: number; theme: string; muted?: boolean; limits: { max: number } }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function show(s: Settings): string { return [s.volume, s.theme, String(s.muted), s.limits.max, Object.keys(s).join("")].join("/") }
function applyTo(s: Settings, v: number): string {
  return [attempt(() => (s.volume = v)), attempt(() => (s.theme = "t" + v)), attempt(() => (s.muted = v > 1)), attempt(() => (s.limits.max += v)), attempt(() => (s.limits = { max: v }))].join()
}
function fresh(theme: string): Settings { return { volume: 1, theme, limits: { max: 1 } } }
const compiled: Settings = { volume: 1, theme: "c", limits: { max: 1 } }
console.log(applyTo(compiled, 2), show(compiled))
const frozen: Settings = Object.freeze(fresh("f"))
const sealed: Settings = Object.seal(fresh("s"))
const closedUp: Settings = Object.preventExtensions(fresh("p"))
console.log(applyTo(frozen, 7), show(frozen))
console.log(applyTo(sealed, 8), show(sealed))
console.log(applyTo(closedUp, 9), show(closedUp), attempt(() => delete closedUp.muted), Object.isFrozen(frozen), Object.isSealed(sealed), Object.isExtensible(closedUp))
// Parsed JSON used as the type.
const text = '{"volume":1,"theme":"j","limits":{"max":1}}'
const parsed: Settings = JSON.parse(text)
console.log(applyTo(parsed, 3), show(parsed))
// The receiver is evaluated before the right-hand side, the store happens after it.
let current: Settings = compiled
function swap(): number { current = parsed; return 21 }
current.volume = swap()
console.log(compiled.volume, parsed.volume, current === parsed)
const late: Settings = { volume: 0, theme: "late", limits: { max: 0 } }
console.log(attempt(() => { late.volume = (Object.freeze(late), 5) }), late.volume, attempt(() => { late.limits.max = (Object.freeze(late.limits), 5) }), late.limits.max)
const all: Settings[] = [compiled, parsed, sealed, closedUp, fresh("x")]
let sum = 0
for (let i = 0; i < 100; i++) { const s = all[i % all.length]; s.volume = i; s.limits.max = i; sum += s.volume + s.limits.max }
console.log(sum)

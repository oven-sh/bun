// Types that accept any object, such as `Pick<..>` of optional fields, in unions with other types.
interface Options { strict?: boolean; noImplicitAny?: boolean; target?: number; types?: string[] }
type Raw = { strict?: boolean; noImplicitAny?: boolean; target?: number; types?: string[]; all?: boolean }
function hasTypes(o: Options): o is Options & { types: string[] } { return o.types !== undefined }
function strictValue(o: Options, flag: "noImplicitAny") { return o[flag] === undefined ? !!o.strict : !!o[flag] }
let last: unknown
const computed = {
    noImplicitAny: { computeValue: (o: Pick<Options, "strict" | "noImplicitAny">) => { last = o; return strictValue(o, "noImplicitAny") } },
    target: { computeValue: (o: Pick<Options, "target">) => { last = o; return o.target ?? 1 } },
}
// The target of the guard is a layout that has to be made: a literal is made as it.
const withTypes: Options & { types: string[] } = { types: ["x", "y"], strict: false }
function load(text: string): Options { const raws: Raw[] = JSON.parse("[" + text + "]"); return raws[0] }
// Called the way the benchmark calls them: by name, through a type that says `Options`. No upcast leads from `Options` to the `Pick`: the callback is entered from code that does not know its parameter's type.
const byName = computed as unknown as Record<string, { computeValue(o: Options): unknown }>
for (const text of ['{"strict":true}', '{"strict":true,"noImplicitAny":false}', '{}', '{"types":["a"],"target":5,"extra":1}']) {
    const options = load(text)
    const strict = byName["noImplicitAny"].computeValue(options)
    const sameForStrict = last === options
    const target = byName["target"].computeValue(options)
    console.log(text, strict, sameForStrict, target, last === options, hasTypes(options), Object.keys(options).join())
}
function count(o: Options) { return hasTypes(o) ? o.types.length : -1 }
console.log(count(withTypes), count({ strict: true }))
// A store through the narrow type is a store to the one object.
function setStrict(o: Pick<Options, "strict" | "noImplicitAny">) { (o as { strict?: boolean }).strict = false }
const shared = load('{"strict":true}')
setStrict(shared)
console.log(shared.strict, JSON.stringify(shared), computed.noImplicitAny.computeValue(withTypes), last === withTypes, hasTypes(withTypes) && withTypes.types.length)
// NEGATIVE: a type that nothing untyped reaches is still distinguished: the literal has a fixed layout and the guard tests the layout.
interface Shape { kind?: string; size?: number }
function isSized(s: Shape): s is Shape & { size: number } { return s.size !== undefined }
const sized: Shape & { size: number } = { kind: "c", size: 3 }
const shapes: Shape[] = [{ kind: "a" }, { kind: "b", size: 2 }, sized]
console.log(shapes.map(s => isSized(s) ? s.size : -1).join())
export {}

// Destructuring of typed objects: rest objects, defaults, renames, nested patterns, computed keys, parameters, and assignment patterns into fields.
interface Props { id: number; title: string; hidden?: boolean; size?: number; style: { color: string; width?: number } }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
const props: Props = { title: "t", id: 1, style: { color: "red" }, size: 0 }

// The rest object has the remaining properties, in source order, and is a new plain object.
const { id, ...withoutId } = props
const { style, title, ...small } = props
const { ...everything } = props
console.log(id, show(withoutId), title, style === props.style, show(small), show(everything), everything !== props)
const { hidden, ...noHidden } = props
console.log(hidden, show(noHidden), "hidden" in noHidden)

// Defaults apply to undefined and to absent, not to other falsy values or null.
function defaults({ id, hidden = true, size = 10, title = "none" }: Partial<Props>): string { return [id, hidden, size, title].join() }
console.log(defaults(props), defaults({}), defaults({ hidden: false, size: undefined, title: "" }), defaults({ size: NaN }))
const effects: string[] = []
function note<T>(label: string, v: T): T { effects.push(label); return v }
const { size: sz = note("size default", 5), hidden: hd = note("hidden default", false) } = props
console.log(sz, hd, effects.join())

// Nested patterns and renames.
const { style: { color, width = 3, ...styleRest }, id: renamed } = props
console.log(color, width, show(styleRest), renamed)
function nestedDefault({ style: { color = "none" } = { color: "fallback" } }: { style?: { color?: string } }): string { return color }
console.log(nestedDefault({}), nestedDefault({ style: {} }), nestedDefault({ style: { color: "blue" } }))

// Computed keys: evaluated in order, left out of the rest.
const which = "title"
const { [which]: chosen, ...others } = props
console.log(String(chosen), show(others))

// Extra properties, symbols and indices added through `any` end up in the rest object; non-enumerable ones do not.
const sym = Symbol("s")
const dressed: Props = { id: 2, title: "d", style: { color: "c" } }
const anyDressed: any = dressed
anyDressed.extra = 1; anyDressed[sym] = 2; anyDressed[0] = 3
Object.defineProperty(dressed, "secret", { value: 4, enumerable: false })
const { title: dressedTitle, ...dressedRest } = dressed
console.log(dressedTitle, show(dressedRest), (dressedRest as any)[sym], "secret" in dressedRest, Reflect.ownKeys(dressedRest).length)

// Getters run in the order of the pattern, then the rest in the order of the keys.
const trace: string[] = []
const live = { get a() { trace.push("a"); return 1 }, get b() { trace.push("b"); return 2 }, get c() { trace.push("c"); return 3 }, get d() { trace.push("d"); return 4 } }
const { c: liveC, a: liveA, ...liveRest } = live
console.log(liveC, liveA, show(liveRest), trace.join())

// Class instances: inherited members can be picked, the rest has own fields only.
class Widget { x = 1; y = 2; get area() { return this.x * this.y } grow() { return ++this.x } }
const { area, grow, x: wx, ...widgetRest } = new Widget()
console.log(area, typeof grow, wx, show(widgetRest), attempt(() => grow()))

// Plain data used as the type.
const parsed: Props = JSON.parse('{"style":{"color":"j","width":1},"title":"json","more":[1],"id":9}')
const { id: parsedId, style: { width: parsedWidth }, ...parsedRest } = parsed
console.log(parsedId + 1, parsedWidth, show(parsedRest))

// Nothing to destructure.
console.log(attempt(() => { const { id } = undefined as unknown as Props; return id }), attempt(() => { const { ...r } = null as unknown as Props; return r }), attempt(() => { const { style: { color } } = { id: 1 } as unknown as Props; return color }))

// Assignment patterns store into typed fields and swap them.
interface Pt { x: number; y: number; tag?: string }
const pt: Pt = { x: 1, y: 2 }
;({ x: pt.y, y: pt.x } = pt)
console.log(show(pt))
;[pt.x, pt.y] = [pt.y, pt.x]
;({ title: pt.tag, id: pt.x = 50 } = props)
console.log(show(pt))
const bucket: { rest?: object; first?: number } = {}
;({ id: bucket.first, ...bucket.rest } = props)
console.log(bucket.first, show(bucket.rest ?? {}), Object.keys(bucket).join())

// In loops and callbacks.
const items: Props[] = [props, dressed, parsed]
const seen: string[] = []
for (const { id, title, size = -1, ...more } of items) seen.push(id + title + size + Object.keys(more).length)
console.log(seen.join(), items.map(({ style: { color }, hidden = false }) => color + hidden).join())

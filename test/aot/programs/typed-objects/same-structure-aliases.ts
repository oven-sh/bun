// Type aliases, anonymous object types and `typeof` types with the same or overlapping structure: an object created as one is used as the others.
type PointA = { x: number; y: number }
type PointB = { x: number; y: number }
type PointC = { y: number; x: number }
type Point3 = { x: number; y: number; z: number }
type MaybeZ = { x: number; y: number; z?: number }
type Renamed = PointA
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function sumA(p: PointA): number { return p.x + p.y }
function sumB(p: PointB): number { return p.x + p.y }
function sumC(p: PointC): number { return p.x * 10 + p.y }
function sumInline(p: { y: number }): number { return p.y + 1 }
function zOf(p: MaybeZ): number | undefined { return p.z }
const a: PointA = { x: 1, y: 2 }
const b: PointB = { y: 4, x: 3 }
const c: PointC = { y: 6, x: 5 }
const d: Point3 = { z: 9, x: 7, y: 8 }
const e: Renamed = { x: 10, y: 11 }
const inferred = { x: 12, y: 13 }
const template = { x: 0, y: 0, note: "t" }
type FromValue = typeof template
const f: FromValue = { note: "f", y: 15, x: 14 }
const points: PointA[] = [a, b, c, d, e, inferred, f, template]
console.log(points.map(sumA).join(), points.map(sumB).join(), points.map(sumC).join(), points.map(sumInline).join())
console.log(points.map(show).join(" ; "))

const maybes: MaybeZ[] = [a, b, c, d, e]
console.log(maybes.map(zOf).map(String).join(), maybes.map(p => "z" in p).join())
const viaMaybe: MaybeZ = a
viaMaybe.z = 3
console.log(show(a), zOf(a), (a as MaybeZ).z, sumA(a), viaMaybe === a)

function moveB(p: PointB, by: number): void { p.x += by; p.y -= by }
for (const p of points) moveB(p, 0.5)
console.log(a.x, b.y, c.x, d.z, e.y, inferred.x, f.note, template.y, points.map(sumC).join())

type Segment = { from: PointA; to: PointB }
type Route = { segments: Segment[]; isLoop: boolean }
const segment: Segment = { from: c, to: d }
const route: Route = { segments: [segment, { from: a, to: a }], isLoop: false }
console.log(route.segments.map(s => sumA(s.from) + ":" + sumB(s.to)).join(), route.segments[1].from === route.segments[1].to, segment.to === d, (segment.to as Point3).z)
segment.to = { x: -1, y: -2 }
console.log(show(segment.to), "z" in segment.to, zOf(segment.to), d.z)

// One alias name, two types, with the kinds of the fields the other way round.
function first(): string { type Local = { v: number; w: string }; const l: Local = { v: 1, w: "a" }; return show(l) + (l.v + 1) + (l.w + 1) }
function second(): string { type Local = { w: number; v: string }; const l: Local = { w: 2, v: "b" }; return show(l) + (l.v + 1) + (l.w + 1) }
console.log(first(), second())

// A field name that is a number in one type and a string in another; both are read through a third type.
type NumV = { v: number }
type StrV = { v: string }
type AnyV = { v: unknown }
const numV: NumV = { v: 1.5 }
const strV: StrV = { v: "s" }
const anyVs: AnyV[] = [numV, strV, { v: null }, { v: [1] }, { v: undefined }, { v: numV }]
console.log(anyVs.map(o => typeof o.v).join(), numV.v + 1, strV.v + 1, anyVs[5].v === numV)
numV.v = -0
strV.v = ""
console.log(anyVs.map(o => Object.is(o.v, -0) ? "-0" : JSON.stringify(o.v)).map(String).join("|"))

// The type of a parameter written in place, with the fields in another order and one more optional field each time.
function inPlace1(p: { y: number; x: number; tag?: string }): string { return p.x + "/" + p.y + "/" + p.tag }
function inPlace2(p: { tag?: string; weight?: number; x: number }): string { return p.x + "/" + p.tag + "/" + p.weight }
console.log(points.map(inPlace1).join(), points.map(inPlace2).join())
const tagged: { x: number; y: number; tag?: string } = b
tagged.tag = "late"
console.log(inPlace1(b), inPlace2(b), show(b), inPlace1(a), inPlace2(d))

let total = 0
for (let i = 0; i < 4000; i++) { const p = points[i & 7]; total += sumA(p) + sumC(p) + sumInline(p) + (zOf(maybes[i % 5]) ?? 0) }
console.log(total)

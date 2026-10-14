type Circle = { kind: "circle"; radius: number; centre: { x: number }; note?: string }
type Square = { kind: "square"; side: number; corner: { y: number }; memo?: string }
type Shape = Circle | Square
interface AnyKind { kind: string }
function keys(o: object): string { return Object.keys(o).join() }
function describe(s: Shape): string {
  switch (s.kind) {
    case "circle": return "circle " + ("radius" in s) + " " + (s.centre === undefined ? "no centre" : s.centre.x) + " " + s.note
    case "square": return "square " + ("side" in s) + " " + (s.corner === undefined ? "no corner" : s.corner.y) + " " + s.memo
  }
}
function measure(s: Shape): number { return s.kind === "circle" ? s.radius * 2 : s.side * 4 }
function readTwice(s: Shape): string { if (s.kind === "circle") return "c" + s.radius; if (s.kind === "square") return "s" + s.side; return "neither" }
function makeCircle(radius: number): Circle { return { kind: "circle", radius, centre: { x: radius + 0.5 } } }
function makeSquare(side: number): Square { return { side, corner: { y: -side }, kind: "square", memo: "m" + side } }
function setKind(s: { kind: Shape["kind"] }, k: Shape["kind"]): void { s.kind = k }
function kindOf(s: Shape): string { return s.kind }

// Four ways to change it.
const viaWide = makeCircle(1)
const wide: AnyKind = viaWide
wide.kind = "square"
const viaAny = makeCircle(2)
;(viaAny as any).kind = "square"
const viaUnion = makeCircle(4)
setKind(viaUnion, "square")
const viaReflect = makeCircle(5)
Reflect.set(viaReflect, "kind", "squ" + "are")
const changed: Shape[] = [viaWide, viaAny, viaUnion, viaReflect]
console.log(changed.map(kindOf).join(), changed.map(keys).join(" ; "), changed.map(s => JSON.stringify(s)).join(""))
console.log(viaWide.radius, viaWide.centre.x, viaAny.radius, wide.kind, (viaAny as any).kind)

// And back.
for (const s of changed) setKind(s, "circle")
console.log(changed.map(describe).join(" ; "), changed.map(measure).join(), changed.map(readTwice).join(), viaAny.kind, viaAny.radius)

// The other direction, and an object that has been both several times.
const back = makeSquare(6)
const trail: string[] = []
for (let i = 0; i < 4; i++) { setKind(back, i & 1 ? "square" : "circle"); trail.push(i & 1 ? describe(back) : kindOf(back)) }
console.log(trail.join(" ; "), measure(back), keys(back))

// Foreign objects with the fields of the branch they name.
const foreignCircle: Shape = JSON.parse('{"kind":"circle","radius":2,"centre":{"x":1}}')
const foreignSquare: Shape = JSON.parse('{"corner":{"y":2},"side":3,"kind":"square"}')
console.log(describe(foreignCircle), describe(foreignSquare), measure(foreignCircle), measure(foreignSquare), keys(foreignSquare))

// Classes as branches.
class Disc { readonly kind = "disc" as const; constructor(public r: number, public hub: { x: number }) {} grow() { return ++this.r } }
class Tile { readonly kind = "tile" as const; constructor(public s: number, public edge: { y: number }) {} grow() { return this.s *= 2 } }
type Piece = Disc | Tile
function pieceInfo(p: Piece): string {
  return p.kind === "disc" ? "disc " + (p.hub === undefined ? "no hub" : p.hub.x) + " " + (p instanceof Disc) + " " + p.grow()
    : "tile " + (p.edge === undefined ? "no edge" : p.edge.y) + " " + (p instanceof Tile) + " " + p.grow()
}
const disc = new Disc(1, { x: 1 })
const tile = new Tile(1, { y: 2 })
console.log(pieceInfo(disc), pieceInfo(tile))
;(disc as { kind: string }).kind = "tile"
;(tile as { kind: string }).kind = "disc"
console.log(disc.grow(), tile.grow(), disc.r, tile.s, JSON.stringify(disc), JSON.stringify(tile))
;(disc as { kind: string }).kind = "disc"
;(tile as { kind: string }).kind = "tile"
console.log(pieceInfo(disc), pieceInfo(tile))

// One access site, every sort of object, many times.
const mixture: Shape[] = [makeCircle(1), makeSquare(2), ...changed, foreignCircle, foreignSquare, back]
let total = 0
for (let i = 0; i < 5000; i++) { const s = mixture[i % mixture.length]; total += measure(s) + describe(s).length; if (i === 2500) for (const c of changed) { setKind(c, "square"); setKind(c, "circle") } }
console.log(total)

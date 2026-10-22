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
function giveSquareFields(o: any, side: number): void { o.side = side; o.corner = { y: side * 10 } }

// Five ways to change it: none is refused.
const viaWide = makeCircle(1)
const wide: AnyKind = viaWide
try { wide.kind = "square"; console.log("through a wider type: no error") } catch (e) { console.log("through a wider type:", e instanceof TypeError ? "TypeError" : "other " + e) }
const viaAny = makeCircle(2)
try { (viaAny as any).kind = "square"; console.log("through any: no error") } catch (e) { console.log("through any:", e instanceof TypeError ? "TypeError" : "other " + e) }
const viaAssign = makeCircle(3)
try { Object.assign(viaAssign, { kind: "square" }); console.log("Object.assign: no error") } catch (e) { console.log("Object.assign:", e instanceof TypeError ? "TypeError" : "other " + e) }
const viaUnion = makeCircle(4)
try { setKind(viaUnion, "square"); console.log("through the union of the kinds: no error") } catch (e) { console.log("through the union of the kinds:", e instanceof TypeError ? "TypeError" : "other " + e) }
const viaReflect = makeCircle(5)
try { Reflect.set(viaReflect, "kind", "squ" + "are"); console.log("Reflect.set: no error") } catch (e) { console.log("Reflect.set:", e instanceof TypeError ? "TypeError" : "other " + e) }
const changed: Shape[] = [viaWide, viaAny, viaAssign, viaUnion, viaReflect]
console.log(changed.map(s => s.kind).join(), changed.map(keys).join(" ; "))

// Every narrowing by the discriminant takes the arm that the value names.
for (const s of changed) try { describe(s); console.log("switch: no error") } catch (e) { console.log("switch:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { measure(viaWide); console.log("conditional, the other branch: no error") } catch (e) { console.log("conditional, the other branch:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { readTwice(viaWide); console.log("second if: no error") } catch (e) { console.log("second if:", e instanceof TypeError ? "TypeError" : "other " + e) }

// The same when they have what a square has, as extra properties.
changed.forEach((s, i) => giveSquareFields(s, i + 1))
console.log(keys(viaWide))
try { describe(viaWide); console.log("with the fields of the arm as extra properties: no error") } catch (e) { console.log("with the fields of the arm as extra properties:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { for (const s of changed) if (s.kind === "square") { s.side += 0.5 }; console.log("store in the arm: no error") } catch (e) { console.log("store in the arm:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(JSON.stringify(viaWide), viaWide.radius, viaWide.centre.x)

// And back: all is well again.
for (const s of changed) setKind(s, "circle")
console.log(changed.map(describe).join(" ; "), changed.map(measure).join())

// The other direction.
const back = makeSquare(6)
setKind(back, "circle")
try { describe(back); console.log("a square called circle: no error") } catch (e) { console.log("a square called circle:", e instanceof TypeError ? "TypeError" : "other " + e) }
setKind(back, "square")
console.log(describe(back))

// Parsed objects that have the fields of the other arm: nothing is copied, and a missing field reads `undefined`.
const circleWithFieldsOfSquare: Shape = JSON.parse('{"kind":"circle","side":3,"corner":{"y":2},"memo":"not read"}')
const squareWithFieldsOfCircle: Shape = JSON.parse('{"kind":"square","radius":1,"centre":{"x":9},"note":"not read"}')
try { describe(circleWithFieldsOfSquare); console.log("foreign, called circle: no error") } catch (e) { console.log("foreign, called circle:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { describe(squareWithFieldsOfCircle); console.log("foreign, called square: no error") } catch (e) { console.log("foreign, called square:", e instanceof TypeError ? "TypeError" : "other " + e) }
setKind(circleWithFieldsOfSquare, "square"); setKind(squareWithFieldsOfCircle, "circle")
console.log(describe(circleWithFieldsOfSquare), describe(squareWithFieldsOfCircle))

// A discriminant becomes an accessor.
const flipping: Shape = makeCircle(7)
let flips = 0
try { Object.defineProperty(flipping, "kind", { get() { return flips++ % 2 ? "square" : "circle" }, enumerable: true, configurable: true }); console.log("accessor: no error") } catch (e) { console.log("accessor:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(measure(flipping), describe(flipping), flips)

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
;(disc as { kind: string }).kind = "tile"
;(tile as { kind: string }).kind = "disc"
try { pieceInfo(disc); console.log("a Disc called tile: no error") } catch (e) { console.log("a Disc called tile:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { pieceInfo(tile); console.log("a Tile called disc: no error") } catch (e) { console.log("a Tile called disc:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(disc.r, tile.s, JSON.stringify(disc), JSON.stringify(tile))

// Objects travel through `unknown`, typed fields, arrays, Maps, results and generics, and are used again under their own type.
interface Engine { power: number; parts: string[] }
interface Owner { nick: string }
interface Car { wheels: number; engine: Engine; trailer?: Car; owner: Owner | null; paint?: string; honk?(): string }
interface Fish { fins: number; school?: Fish[]; habitat: { salt: boolean }; paint?: string }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function nickOf(o: Owner): string { return o.nick }
const fish: Fish = { fins: 2, habitat: { salt: true }, paint: "silver" }
const car: Car = { wheels: 4, engine: { power: 90, parts: ["p"] }, owner: null }
const towed: Car = { wheels: 2, engine: { power: 0, parts: [] }, owner: { nick: "o" }, paint: "blue", honk() { return "beep " + this.wheels } }
car.trailer = towed
console.log(String(car.trailer?.engine.power), car.owner?.nick ?? "nobody", car.honk?.() ?? "silent", towed.honk?.(), attempt(() => nickOf(car.owner as Owner)), nickOf(towed.owner as Owner))
const nothing = null as unknown as Car, missing = undefined as unknown as Car
console.log(nothing === null, missing === undefined, attempt(() => nothing.engine), attempt(() => missing.paint), nothing?.paint ?? "none", attempt(() => { missing.paint = "x" }))
// Classes and a literal of the class's type.
class Beta { b = "two"; run() { return "beta" + this.b } onlyBeta() { return "B" } }
const runners: Beta[] = [new Beta(), { b: "lit", run() { return "literal" + this.b }, onlyBeta: () => "L" }]
console.log(runners.map(r => r.run()).join(), runners.map(r => r.onlyBeta()).join(), runners.map(r => r instanceof Beta).join())
interface Garage { main: Car; others: Car[]; byPlate: Map<string, Car> }
const garage: Garage = { main: towed, others: [towed, car], byPlate: new Map([["x", towed]]) }
function pickCar(g: Garage, i: number): Car { return i < 0 ? g.main : g.others[i] }
function same<T>(x: T): T { return x }
console.log(pickCar(garage, -1) === towed, pickCar(garage, 0).paint, String(pickCar(garage, 5)), garage.byPlate.get("x") === towed, same<Car>(garage.main).engine.power)
const back = same(pickCar(garage, 0)) as unknown as Car, swum = same<unknown>(fish) as Fish
console.log(back === towed, back.wheels + 1, back.paint, swum === fish, swum.fins + 1, swum.habitat.salt, String(swum.school))
function classify(x: Car | Fish): string { return "habitat" in x ? "fish:" + x.habitat.salt : "car:" + typeof x.engine }
console.log(classify(car), classify(fish), classify(back), classify(swum))
const lot: Car[] = [car, towed, back]
let n = 0
for (let i = 0; i < 132; i++) { const c = lot[i % lot.length]; if (c.engine) n += c.engine.power; if (c.paint) n += c.paint.length; if (c.trailer) n++; if (c.owner) n += c.owner.nick.length }
console.log(n)

// `x as unknown as T` never throws for an object: `x` may be a typed object of an unrelated type, a built-in object, or data that lacks what `T` requires.
interface Engine { power: number; parts: string[] }
interface Car { wheels: number; engine: Engine; trailer?: Car; paint?: string; honk?(): string }
interface Fish { fins: number; habitat: { salt: boolean }; paint?: string }
interface Boat { paint?: string; engine: Engine; sails: number }
function rule(label: string, f: () => unknown) { try { console.log(label + ": no error", f()) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }
const fish: Fish = { fins: 2, habitat: { salt: true }, paint: "silver" }
const boat: Boat = { sails: 2, engine: { power: 7, parts: ["mast"] }, paint: "white" }
class Alpha { a = 1; run() { return "alpha" + this.a } }
class Beta { b = "two"; run() { return "beta" + this.b } }
class Goose { honk() { return "goose" } }
rule("a record of an unrelated type", () => (fish as unknown as Car).paint)
rule("a record that shares names", () => (boat as unknown as Car).engine.power)
rule("an instance of an unrelated class", () => (new Alpha() as unknown as Beta).run())
rule("an instance that has an optional member of the type only", () => (new Goose() as unknown as Car).honk?.())
const strangers: [string, unknown][] = [["array", [1, 2]], ["Map", new Map()], ["function", () => 1], ["RegExp", /re/], ["object without prototype", Object.create(null)], ["empty object", JSON.parse("{}")], ["proxy", new Proxy({}, {})]]
for (const [label, x] of strangers) rule(label, () => (x as Car).paint)
console.log(JSON.stringify(fish), JSON.stringify(boat))

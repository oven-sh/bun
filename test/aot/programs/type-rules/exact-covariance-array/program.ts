interface Animal { species: string; legs: number }
interface Dog extends Animal { bark(): string; tricks: string[] }
interface Cat extends Animal { meow(): string; lives?: number }
function dog(n: number): Dog { return { species: "dog" + n, legs: 4, bark() { return "woof " + this.species }, tricks: ["sit"] } }
function cat(n: number): Cat { return { meow() { return "meow " + this.species }, species: "cat" + n, legs: 4, lives: 9 - n } }
function rule(label: string, f: () => unknown) { try { console.log(label + ": no error", f()) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }

const dogs: Dog[] = [dog(0), dog(1)]
const animals: Animal[] = dogs
animals.push(cat(0))
animals[0] = cat(1)
rule("parameter of a callback of map", () => dogs.map(d => d.species + d.legs).join())
rule("for of", () => { let text = ""; for (const d of dogs) text += d.species; return text })
rule("element read", () => { const stray = dogs[2]; return stray.species })
rule("element read, then a store to it", () => { const odd = dogs[0]; odd.legs = 3; return odd.legs })
console.log(animals.map(a => a.species + a.legs).join(), dogs[1].bark())

class Pet { constructor(public tagName: string) {} speak(): string { return "..." } describe(): string { return this.tagName + " says " + this.speak() } }
class Hound extends Pet { nose = 10; speak() { return "woof" } sniff() { return this.nose * 2 } }
class Tabby extends Pet { claws = 18; speak() { return "meow" } scratch() { return this.claws + 1 } }
const hounds: Hound[] = [new Hound("h0")]
const pets: Pet[] = hounds
pets.push(new Tabby("t0"), new Pet("p0"), new Hound("h1"))
rule("instance of a sibling class", () => hounds[1].tagName)
rule("instance of the base class", () => hounds[2].describe())
rule("instances, parameter of a callback", () => hounds.map(h => h.describe()).join())

function append<T>(list: T[], item: T): T[] { list.push(item); return list }
const kennel: Dog[] = [dog(5)]
append<Animal>(kennel, { species: "fish", legs: 0 })
rule("pushed by a generic function", () => kennel[1].legs)

interface Pack { members: Dog[]; leader?: Dog }
interface Herd { members: Animal[]; leader?: Animal }
const pack: Pack = { members: [dog(7)] }
function widen(herd: Herd) { herd.members.push(cat(7)); herd.leader = cat(8) }
widen(pack)
rule("element of an array in a field", () => pack.members[1].species)
rule("field read through the narrower view", () => pack.leader?.species)
const grid: Dog[][] = [[dog(1)], []]
const anyGrid: Animal[][] = grid
anyGrid[1].push(cat(2))
rule("element of an array in an array", () => grid[1][0].species)

const byName = new Map<string, Dog>([["a", dog(1)]])
const wider: Map<string, Animal> = byName
wider.set("b", cat(1))
rule("Map.get", () => byName.get("b")?.species)
const pair: [Dog, Dog] = [dog(2), dog(3)]
const widerPair: [Animal, Animal] = pair
widerPair[1] = cat(4)
rule("element of a tuple", () => pair[1].species)

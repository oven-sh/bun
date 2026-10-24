// A `{ pet: Dog }` used as a `{ pet: Animal }` receives a Cat.
interface Animal { species: string; legs: number }
interface Dog extends Animal { bark(): string; collar?: string }
interface Cat extends Animal { meow(): string }
interface DogOwner { who: string; pet: Dog }
interface AnimalOwner { who: string; pet: Animal }
function rule(label: string, f: () => unknown) { try { console.log(label + ": no error", f()) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }
const rex: Dog = { species: "dog", legs: 4, bark() { return "woof" } }
const tom: Cat = { species: "cat", legs: 4, meow() { return "meow" } }
function adopt(o: AnimalOwner, a: Animal) { o.pet = a }
function petOf(o: AnimalOwner): Animal { return o.pet }

const owner: DogOwner = { who: "ann", pet: rex }
adopt(owner, tom)
rule("a Cat read through the narrow view", () => owner.pet.species)
adopt(owner, { species: "snake", legs: 0 })
rule("a literal of the wide type read through the narrow view", () => owner.pet.legs)
rule("a store to what is read through the narrow view", () => { owner.pet.collar = "red"; return "stored" })
console.log(JSON.stringify(petOf(owner)), owner.who)

class Shelter { resident: Animal = tom; swap(a: Animal) { this.resident = a } legs() { return this.resident.legs } }
class Kennel extends Shelter { declare resident: Dog; noise() { return this.resident.bark() } }
const kennel = new Kennel()
rule("a field declared narrower in the subclass, in a method", () => kennel.noise())
rule("a field declared narrower in the subclass, from outside", () => kennel.resident.species)
console.log(kennel.legs())

interface Handler<T> { handle(x: T): string }
const dogHandler: Handler<Dog> = { handle(d) { return d.species } }
function handleWith(h: Handler<Animal>, a: Animal): string { return h.handle(a) }
rule("a handler for dogs is given a cat", () => handleWith(dogHandler, tom))

interface Frozenish { readonly pet: Dog }
const looked: Frozenish = owner
adopt(owner, tom)
rule("a readonly narrow view", () => looked.pet.species)

interface MaybeDog { pet?: Dog; spare: Dog | null }
interface MaybeAnimal { pet?: Animal; spare: Animal | null }
const maybe: MaybeDog = { spare: null }
function fill(m: MaybeAnimal) { m.pet = tom; m.spare = tom }
fill(maybe)
rule("an optional field", () => maybe.pet?.species)
rule("a field of a union type", () => maybe.spare?.legs)
console.log(Object.keys(maybe).join())

interface Boxed<T> { value: T }
const inner: Boxed<Boxed<Dog>> = { value: { value: rex } }
function refill(outer: Boxed<Boxed<Animal>>) { outer.value.value = tom }
refill(inner)
rule("two levels down", () => inner.value.value.species)
function replace(outer: Boxed<Boxed<Animal>>) { outer.value = { value: { species: "eel", legs: 0 } } }
replace(inner)
rule("a box of the wide type read through the narrow view", () => inner.value.value.species)
interface DogMaker { make: () => Dog }
interface AnimalMaker { make: () => Animal }
const maker: DogMaker = { make: () => rex }
function remake(m: AnimalMaker) { m.make = () => tom }
remake(maker)
rule("the result of a function-typed field", () => maker.make().species)

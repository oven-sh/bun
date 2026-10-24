// Field covariance: a `{ pet: Dog }` is used as a `{ pet: Animal }`, written through the wider type and read through the narrower one.
interface Animal { species: string; legs: number }
interface Dog extends Animal { bark(): string; collar?: string }
interface Cat extends Animal { meow(): string }
interface DogOwner { who: string; pet: Dog }
interface AnimalOwner { who: string; pet: Animal }
const rex: Dog = { species: "dog", legs: 4, bark() { return "woof" } }
const tom: Cat = { species: "cat", legs: 4, meow() { return "meow" } }

const owner: DogOwner = { who: "ann", pet: rex }
const wide: AnimalOwner = owner
console.log(owner.pet.bark(), wide.pet.species, owner.pet === wide.pet)
wide.pet = tom
console.log(wide.pet.species, wide.pet.legs, "bark" in wide.pet, wide.pet === tom, JSON.stringify(owner), owner.who)
wide.pet = { species: "snake", legs: 0 }
console.log(wide.pet.species, wide.pet.legs, Object.keys(wide.pet).join(), JSON.stringify(owner))
owner.pet = rex
owner.pet.collar = "red"
console.log(wide.pet.species, owner.pet.bark(), JSON.stringify(wide.pet), owner.pet.collar)

// The same through a function that only knows the wide type, in a loop over owners of both kinds.
function adopt(o: AnimalOwner, a: Animal) { o.pet = a }
function petOf(o: AnimalOwner): Animal { return o.pet }
const owners: DogOwner[] = []
for (let i = 0; i < 6; i++) owners.push({ who: "o" + i, pet: rex })
for (let i = 0; i < 6; i += 2) adopt(owners[i], i % 4 ? tom : { species: "bird", legs: 2 })
console.log(owners.map(o => o.who + ":" + petOf(o).species + ":" + ("bark" in petOf(o) ? o.pet.bark() : "-")).join())

// Classes: a field declared with a narrower type in the subclass.
class Shelter { resident: Animal = tom; swap(a: Animal) { this.resident = a } legs() { return this.resident.legs } species() { return this.resident.species } }
class Kennel extends Shelter { declare resident: Dog; noise() { return this.resident.bark() } }
const kennel = new Kennel()
console.log(kennel.legs(), kennel.species())
kennel.swap(rex)
console.log(kennel.noise(), kennel.resident.collar, kennel.species())
kennel.swap({ species: "ant", legs: 6 })
console.log(kennel.legs(), kennel.species(), JSON.stringify(kennel))

// Methods are bivariant in their parameters: a handler for dogs, seen as a handler for animals, is given a dog.
interface Handler<T> { handle(x: T): string }
const dogHandler: Handler<Dog> = { handle(d) { return d.species + "/" + d.bark() } }
const anyHandler: Handler<Animal> = dogHandler
console.log(anyHandler.handle(rex))

// Optional and union-typed fields.
interface MaybeDog { pet?: Dog; spare: Dog | null }
interface MaybeAnimal { pet?: Animal; spare: Animal | null }
const maybe: MaybeDog = { spare: null }
const maybeWide: MaybeAnimal = maybe
maybeWide.pet = tom; maybeWide.spare = tom
console.log(maybeWide.pet?.species, maybeWide.spare?.legs, Object.keys(maybe).join())
delete maybeWide.pet; maybeWide.spare = null
console.log(maybe.pet, maybe.spare, "pet" in maybe, maybe.pet?.bark())

// Two levels down, generics, and a function-typed field whose result is covariant.
interface Boxed<T> { value: T }
const inner: Boxed<Boxed<Dog>> = { value: { value: rex } }
const outer: Boxed<Boxed<Animal>> = inner
console.log(inner.value.value.bark())
outer.value.value = tom
console.log(outer.value.value.species, inner.value === outer.value)
outer.value = { value: { species: "eel", legs: 0 } }
console.log(outer.value.value.species, JSON.stringify(inner))
interface DogMaker { make: () => Dog }
interface AnimalMaker { make: () => Animal }
const maker: DogMaker = { make: () => rex }
const wideMaker: AnimalMaker = maker
console.log(maker.make().bark())
wideMaker.make = () => tom
console.log(wideMaker.make().species, maker.make === wideMaker.make)

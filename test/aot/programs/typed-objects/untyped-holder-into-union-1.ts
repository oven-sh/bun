// The parts of the union differ only in what hangs below them. An untyped object that holds an object of the program passes as the union, and both stay the objects they were. Each program of this family has one way into the type.
type Cat = { name: string; lives: number }; type Dog = { name: string; tricks: string }; type Bird = { name: string; wings: number }; type Fish = { name: string; fins: number }; type Ant = { name: string; legs: number };
type CatBox = { pet: Cat }; type DogBox = { pet: Dog }; type BirdBox = { pet: Bird }; type FishBox = { pet: Fish }; type AntBox = { pet: Ant };
type Box = CatBox | DogBox | BirdBox | FishBox | AntBox;
const made: unknown[] = [((): CatBox => ({ pet: { name: "c", lives: 9 } }))(), ((): DogBox => ({ pet: { name: "d", tricks: "t" } }))(), ((): BirdBox => ({ pet: { name: "b", wings: 2 } }))(), ((): FishBox => ({ pet: { name: "f", fins: 3 } }))(), ((): AntBox => ({ pet: { name: "a", legs: 6 } }))()];
function hide(v: unknown): any { return v }
function nameOf(b: Box): string { return b.pet.name }
for (let round = 0; round < 3; round++) { const d: Dog = { name: "rex", tricks: "sit" }; const raw: any = {}; raw.pet = d; const b: Box = raw; console.log(nameOf(b), (b.pet as unknown) === d, (b as unknown) === raw, hide(b.pet).tricks, made.length); }

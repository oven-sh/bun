function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Animal {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

class Dog extends Animal {
  legs = 4;
  tag = "dog tag";
  owner = { id: 7 };
  bark(): string {
    return this.name + " barks on " + this.legs;
  }
}

class Cat extends Animal {
  lives = "nine";
  indoor = true;
  purr(): string {
    return this.name + " purrs";
  }
}

function legsAt(packs: Dog[][], row: number, column: number): number {
  return packs[row][column].legs + 1;
}

function totalLegs(packs: Dog[][]): number {
  let total = 0;
  for (let i = 0; i < packs.length; i++) for (let j = 0; j < packs[i].length; j++) total += packs[i][j].legs;
  return total;
}

function barks(packs: Dog[][]): string {
  let text = "";
  for (const pack of packs) for (const dog of pack) text += dog.bark() + ";";
  return text;
}

function flatLegs(packs: Dog[][]): number[] {
  return packs.flat().map(dog => dog.legs);
}

function make(): Dog[][] {
  return [[new Dog("a"), new Dog("b")], [new Dog("c")]];
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = make();
  warm += legsAt(honest, 0, 1) + totalLegs(honest) + barks(honest).length + flatLegs(honest).length;
}
console.log("after 2000 honest packs", warm);

function report(name: string, packs: Dog[][]): void {
  attempt(name + ": names", () => packs.map(pack => pack.map(dog => dog.name + ":" + dog.constructor.name)));
  attempt(name + ": legs", () => packs.map(pack => pack.map(dog => dog.legs)));
  attempt(name + ": total legs", () => totalLegs(packs));
  attempt(name + ": flat legs", () => flatLegs(packs));
  attempt(name + ": barks", () => barks(packs));
  attempt(name + ": legs at 0, 1", () => legsAt(packs, 0, 1));
}

{
  const packs = make();
  const wide: Animal[][] = packs;
  wide.push([new Cat("tom")]);
  report("a row of cats is pushed", packs);
}
{
  const packs = make();
  const wide: Animal[][] = packs;
  wide[0].push(new Cat("tom"));
  report("a cat is pushed into a row", packs);
}
{
  const packs = make();
  const wide: Animal[][] = packs;
  wide[0][1] = new Cat("tom");
  report("a cat is stored into a row", packs);
}
{
  const packs = make();
  const row: Animal[] = packs[0];
  row[1] = new Cat("tom");
  report("through an alias of one row", packs);
}
{
  const packs = make();
  const wide: Animal[][] = packs;
  wide[0] = [new Cat("tom"), new Cat("kit")];
  report("a row is replaced", packs);
}
{
  const packs = make();
  const wide: (Dog[] | Cat[])[] = packs;
  wide[1] = [new Cat("tom")];
  report("an array of either kind of row", packs);
}
{
  const packs = make();
  const shared = packs[0];
  packs.push(shared);
  const wide: Animal[] = shared;
  wide[0] = new Cat("tom");
  report("one row is there twice", packs);
}
{
  const cube: Dog[][][] = [make()];
  const wide: Animal[][][] = cube;
  wide[0][1][0] = new Cat("tom");
  attempt("three levels", () => cube[0][1][0].legs + cube[0][0][0].legs);
}
report("honest again", make());

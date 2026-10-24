class Person {
  first: string;
  constructor(first: string) {
    this.first = first;
  }
}

class Animal {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

class Dog extends Animal {
  legs: number = 4;
  tag: string = "rex-tag";
  owner: Person = new Person("ann");
  tricks: string[] = ["sit", "roll"];
  bark(): string {
    return this.name + " barks on " + this.legs;
  }
}

class Cat extends Animal {
  lives: string = "nine";
  weight: number = 3.5;
  toys: number[] = [7, 8, 9];
  enemy: Person = new Person("bob");
  purr(): string {
    return this.name + " purrs";
  }
}

class Spider extends Animal {
  legs: string = "eight";
  tag: number = 88;
}

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function put<T>(o: T, k: keyof T, v: T[keyof T]): void {
  o[k] = v;
}

function listing(d: Dog): string {
  const forIn: string[] = [];
  for (const key in d) forIn.push(key);
  return [
    "keys " + Object.keys(d).join(),
    "for-in " + forIn.join(),
    "entries " + Object.entries(d).map(([k, v]) => k + ":" + typeof v).join(),
    "json " + JSON.stringify(d),
    "spread " + Object.keys({ ...d }).join(),
    "names " + Object.getOwnPropertyNames(d).join(),
    "assign " + Object.keys(Object.assign({}, d)).join(),
    "clone " + Object.keys(structuredClone(d)).join(),
  ].join("\n  ");
}

const rex = new Dog("rex");
show("at the start", () => listing(rex));
put(rex, "legs", "four");
show("a string in legs", () => listing(rex));
put(rex, "tag", 12);
show("a number in tag", () => listing(rex));
put(rex, "owner", "nobody");
show("a string in owner", () => listing(rex));
put(rex, "name", 1);
show("a number in name", () => listing(rex));
put(rex, "legs", 4);
put(rex, "tag", "back");
show("legs and tag are right again", () => listing(rex));
show("bark", () => rex.bark());

const fido = new Dog("fido");
const loose: { legs?: number; tag?: string } = fido;
delete loose.legs;
show("legs deleted", () => listing(fido));
fido.legs = 3;
show("legs set again", () => listing(fido));
delete loose.tag;
put(fido, "tag", 5);
show("tag deleted and set to a number", () => listing(fido));

const spot = new Dog("spot");
const wide: { legs: number | undefined | null } = spot;
wide.legs = undefined;
show("undefined in legs", () => listing(spot));
show("legs in spot", () => "legs" in spot);
show("legs", () => spot.legs);
wide.legs = null;
show("null in legs", () => listing(spot));
show("legs", () => spot.legs);
show("legs + 1", () => spot.legs + 1);

const descriptor = Object.getOwnPropertyDescriptor(rex, "legs");
show("descriptor", () => JSON.stringify(descriptor));

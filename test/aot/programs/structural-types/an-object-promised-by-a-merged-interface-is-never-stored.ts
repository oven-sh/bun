function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Person {
  first: string = "ann";
  age: number = 30;
  greet(): string {
    return "hi " + this.first;
  }
}

interface Desk {
  owner: Person;
  size: { width: number; height: number };
}
class Desk {
  id: number = 1;
  ownerName(): string {
    return this.owner.first;
  }
  area(): number {
    return this.size.width * this.size.height;
  }
}

function nameOf(person: Person): string {
  return person.first;
}

function ownerOf(desk: Desk): Person {
  return desk.owner;
}

show("an honest caller", () => nameOf(new Person()));

const desk = new Desk();
show("read", () => desk.owner);
show("typeof", () => typeof desk.owner);
show("equals undefined", () => desk.owner === undefined);
show("equals null", () => desk.owner === null);
show("loosely equals null", () => desk.owner == null);
show("as a condition", () => (desk.owner ? "yes" : "no"));
show("instanceof", () => desk.owner instanceof Person);
show("a member", () => desk.owner.first);
show("a number member", () => desk.owner.age + 1);
show("a member if there", () => desk.owner?.first);
show("a method", () => desk.owner.greet());
show("a method if there", () => desk.owner?.greet());
show("a member of the literal type", () => desk.size.width);
show("in a method", () => desk.ownerName());
show("in another method", () => desk.area());
show("through a function", () => ownerOf(desk));
show("given to a typed function", () => nameOf(desk.owner));
show("or another", () => (desk.owner ?? new Person()).first);
show("a store to its member", () => (desk.owner.age = 31));
show("a typed local", () => {
  const person: Person = desk.owner;
  return person;
});
show("a typed element", () => {
  const people: Person[] = [desk.owner, new Person()];
  return people.length + " " + typeof people[0] + " " + typeof people[1];
});
show("taken apart", () => {
  const { owner } = desk;
  return owner;
});
show("taken apart twice", () => {
  const {
    owner: { first },
  } = desk;
  return first;
});
show("Object.keys of it", () => Object.keys(desk.owner));
show("spread of it", () => ({ ...desk.owner }));
show("JSON of it", () => JSON.stringify(desk.owner));
show("String of it", () => String(desk.owner));
show("in it", () => "first" in desk.owner);
show("in", () => "owner" in desk);
show("keys", () => Object.keys(desk));
show("JSON", () => JSON.stringify(desk));
show("spread", () => ({ ...desk }));
show("an honest caller again", () => nameOf(new Person()));

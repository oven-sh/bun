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
  first: string;
  constructor(first: string) {
    this.first = first;
  }
  greet(): string {
    return "hi " + this.first;
  }
}

interface Source {
  owner: Person;
}
class Source {
  own: number = 1;
}

class Team {
  lead: Person = new Person("lead");
  members: Person[] = [new Person("m")];
  leadName(): string {
    return this.lead.first;
  }
}

function same(person: Person): Person {
  return person;
}

function nameOf(person: Person): string {
  return person.first;
}

function greetingOf(person: Person): string {
  return person.greet();
}

function attempt(run: () => unknown): string {
  try {
    const value = run();
    return typeof value + " " + String(value);
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "another error";
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const team = new Team();
  team.lead = new Person("p" + (i % 3));
  warm += nameOf(same(team.lead)).length + greetingOf(team.lead).length + team.leadName().length + nameOf(team.members[0]).length;
}
show("2000 honest rounds", () => warm);

const source = new Source();

show("a local", () => {
  let person: Person = new Person("before");
  person = source.owner;
  return [typeof person, attempt(() => person.first)];
});
show("a parameter and a result", () => [same(source.owner), attempt(() => nameOf(source.owner)), attempt(() => greetingOf(source.owner)), attempt(() => nameOf(same(source.owner)))]);
show("a field", () => {
  const team = new Team();
  team.lead = source.owner;
  return [team.lead, attempt(() => team.leadName()), Object.keys(team), JSON.stringify(team)];
});
show("an element", () => {
  const team = new Team();
  team.members[0] = source.owner;
  team.members.push(source.owner, new Person("last"));
  return [team.members.length, team.members.map(member => attempt(() => nameOf(member)))];
});
show("a captured variable", () => {
  const held: Person = source.owner;
  const read = (): Person => held;
  return [read(), attempt(() => read().first)];
});
show("a literal", () => {
  const pair: { left: Person; right: Person } = { left: source.owner, right: new Person("r") };
  return [pair.left, nameOf(pair.right), attempt(() => nameOf(pair.left)), Object.keys(pair)];
});
show("a value of a map", () => {
  const map = new Map<string, Person>([["k", source.owner]]);
  return [map.has("k"), map.get("k")];
});
show("a key of a weak map", () => attempt(() => new WeakMap<Person, number>().set(source.owner, 1)));
show("told apart", () => [source.owner instanceof Person, source.owner === undefined, source.owner == null, typeof source.owner]);
show("as this", () => attempt(() => Person.prototype.greet.call(source.owner)));
show("Object.assign onto it", () => attempt(() => Object.assign(source.owner, { first: "x" })));
show("Object.assign from it", () => Object.keys(Object.assign({}, source.owner)));
show("Object.entries of it", () => attempt(() => Object.entries(source.owner)));
show("structuredClone of it", () => structuredClone(source.owner));
show("honest again", () => [nameOf(new Person("a")), greetingOf(new Person("b")), new Team().leadName()]);

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
  age: number = 30;
  constructor(first: string) {
    this.first = first;
  }
  greet(): string {
    return "hi " + this.first;
  }
}

interface Desk {
  owner: Person;
}
class Desk {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
  ownerName(): string {
    return this.owner.first;
  }
}

function filled(id: number): Desk {
  const desk = new Desk(id);
  desk.owner = new Person("p" + (id % 3));
  return desk;
}

function ownerOf(desk: Desk): Person {
  return desk.owner;
}

function ageOf(desk: Desk): number {
  return desk.owner.age;
}

function greetingOf(desk: Desk): string {
  return desk.owner.greet();
}

show("the first call gets one without it", () => ownerOf(new Desk(1)));
show("its age", () => ageOf(new Desk(1)));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += ageOf(filled(i)) + greetingOf(filled(i)).length + ownerOf(filled(i)).first.length + filled(i).ownerName().length;
show("2000 with it", () => sum);
show("one without it", () => ownerOf(new Desk(5)));
show("its age", () => ageOf(new Desk(5)));
show("its greeting", () => greetingOf(new Desk(5)));
show("its method", () => new Desk(5).ownerName());
show("one with it again", () => [ageOf(filled(1)), greetingOf(filled(1)), filled(1).ownerName()]);

show("ages of three, the second without", () => {
  const seen: string[] = [];
  for (const desk of [filled(1), new Desk(2), filled(3)]) {
    try {
      seen.push(String(ageOf(desk)));
    } catch (error) {
      seen.push(error instanceof TypeError ? "TypeError" : "another error");
    }
  }
  return seen;
});
show("keys of both", () => [Object.keys(filled(1)), Object.keys(new Desk(1))]);
show("JSON of both", () => JSON.stringify([filled(1), new Desk(1)]));

const late = new Desk(1);
show("before the store", () => [late.owner, "owner" in late]);
late.owner = new Person("late");
show("after the store", () => [late.owner.first, "owner" in late, late.ownerName(), ageOf(late)]);
show("keys", () => Object.keys(late));

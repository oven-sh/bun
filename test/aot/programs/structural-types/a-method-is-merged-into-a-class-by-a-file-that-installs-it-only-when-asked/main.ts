import { Dog, Puppy } from "./dog.ts";
import { installRoll, rollOf } from "./tricks.ts";

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

const dog = new Dog();
const puppy = new Puppy();
show("before: typeof", () => [typeof dog.roll, typeof puppy.roll, typeof dog.sit]);
show("before: called here", () => dog.roll(2));
show("before: called by the other file", () => rollOf(dog, 2));
show("before: on the subclass", () => rollOf(puppy, 2));
show("before: names of the prototype", () => Object.getOwnPropertyNames(Dog.prototype));

installRoll();

show("after: typeof", () => [typeof dog.roll, typeof puppy.roll, typeof dog.sit]);
show("after: called here", () => dog.roll(2));
show("after: called by the other file", () => rollOf(dog, 2));
show("after: on the subclass", () => rollOf(puppy, 2));
show("after: names of the prototype", () => Object.getOwnPropertyNames(Dog.prototype));
show("after: the one nobody installs", () => dog.sit());
show("after: keys", () => [Object.keys(dog), Object.keys(puppy)]);
let sum = 0;
for (let i = 0; i < 2000; i++) sum += rollOf(i % 2 === 0 ? dog : puppy, i);
show("2000 calls", () => sum);

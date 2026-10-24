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

class Person {
  first: string = "ann";
  greet(): string {
    return "hi " + this.first;
  }
}

const early: string[] = [];

class Base {
  constructor() {
    this.init();
  }
  init(): void {}
}

class Form extends Base {
  owner: Person = new Person();
  title: string = "form";
  fields: string[] = ["a", "b"];
  submit: () => number = () => 1;
  width: number = 10;
  init(): void {
    early.push("owner?.first " + this.owner?.first);
    early.push("owner?.greet() " + this.owner?.greet());
    early.push("title?.length " + this.title?.length);
    early.push("title?.toUpperCase() " + this.title?.toUpperCase());
    early.push("fields?.length " + this.fields?.length);
    early.push("fields?.[0] " + this.fields?.[0]);
    early.push("fields?.map " + this.fields?.map(f => f + f));
    early.push("submit?.() " + this.submit?.());
    early.push("width?.toFixed " + this.width?.toFixed(1));
    early.push("owner ?? " + (this.owner ?? "nobody"));
    early.push("width ?? " + (this.width ?? -1));
    early.push("title ?? " + (this.title ?? "untitled"));
    early.push("owner === undefined " + (this.owner === undefined));
    early.push("owner == null " + (this.owner == null));
    early.push("!owner " + !this.owner);
    early.push("owner && " + (this.owner && this.owner.first));
    early.push("typeof owner " + typeof this.owner);
    early.push("width === undefined " + (this.width === undefined));
    early.push("width !== undefined ? " + (this.width !== undefined ? this.width + 1 : "no width"));
    early.push("isNaN " + Number.isNaN(this.width));
  }
  fill(): void {
    this.width ??= 20;
    this.title ||= "filled";
  }
}

const form = new Form();
for (const entry of early) console.log("early " + entry);
early.length = 0;
form.init();
for (const entry of early) console.log("late " + entry);

class Slot {
  declare value: number;
  declare label: string;
  declare next: Slot;
  fill(): void {
    this.value ??= 20;
    this.label ||= "filled";
  }
  depth(): number {
    return this.next?.depth() + 1;
  }
  depthOrZero(): number {
    return (this.next?.depthOrZero() ?? 0) + 1;
  }
}
const slot = new Slot();
show("value before", () => slot.value);
slot.fill();
show("value after ??=", () => slot.value);
show("label after ||=", () => slot.label);
slot.fill();
show("value after another", () => slot.value);
show("depth", () => slot.depth());
show("depthOrZero", () => slot.depthOrZero());
slot.next = new Slot();
slot.next.next = new Slot();
show("depthOrZero of three", () => slot.depthOrZero());

const list: Person[] = [new Person()];
show("past the end ?.", () => list[3]?.first);
show("past the end ?.()", () => list[3]?.greet());
show("past the end", () => list[3].first);
const table: Record<string, Person> = { a: new Person() };
show("no such key ?.", () => table["b"]?.first);
show("no such key", () => table["b"].first);

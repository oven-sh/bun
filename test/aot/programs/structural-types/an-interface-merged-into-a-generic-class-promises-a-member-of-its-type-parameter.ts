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

interface Box<T> {
  spare: T;
  spares: T[];
}
class Box<T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
  either(): T {
    return this.spare ?? this.value;
  }
  swap(): void {
    const held = this.value;
    this.value = this.spare;
    this.spare = held;
  }
}

function spareOf<T>(box: Box<T>): T {
  return box.spare;
}

function spareNumber(box: Box<number>): number {
  return box.spare + 1;
}

function spareText(box: Box<string>): number {
  return box.spare.length;
}

const numbers = new Box(1.5);
const texts = new Box("text");
const lists = new Box([1, 2]);
const points = new Box({ x: 1 });

show("of number", () => [numbers.spare, spareOf(numbers), numbers.spare + 1, spareNumber(numbers)]);
show("of string", () => [texts.spare, spareOf(texts), texts.spare + "!"]);
show("of string: length", () => spareText(texts));
show("of a list", () => [lists.spare, spareOf(lists)]);
show("of a list: length", () => lists.spare.length);
show("of an object", () => [points.spare, spareOf(points)]);
show("of an object: member", () => points.spare.x);
show("the list of them", () => [numbers.spares, texts.spares]);
show("either", () => [numbers.either(), texts.either(), lists.either()]);
show("keys", () => [Object.keys(numbers), Object.keys(texts)]);

numbers.swap();
show("swapped: value", () => numbers.value);
show("swapped: value plus one", () => numbers.value + 1);
show("swapped: spare", () => [numbers.spare, spareNumber(numbers)]);
show("swapped: keys", () => Object.keys(numbers));
show("swapped: JSON", () => JSON.stringify(numbers));

texts.swap();
show("swapped text: value", () => texts.value);
show("swapped text: length of the value", () => texts.value.length);
show("swapped text: spare", () => [texts.spare, spareText(texts)]);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += spareNumber(numbers);
show("2000 where it is", () => sum);
show("one where it is not", () => spareNumber(new Box(2)));

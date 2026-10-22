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
}

class Sheet {
  width!: number;
  title!: string;
  owner!: Person;
  rows!: number[];
  onChange!: () => number;
  ready!: boolean;
  height: number = 2;
  setUp(): void {
    this.width = 3;
    this.title = "t";
    this.owner = new Person();
    this.rows = [1];
    this.onChange = () => 9;
    this.ready = true;
  }
  area(): number {
    return this.width * this.height;
  }
  widthPlusOne(): number {
    return this.width + 1;
  }
  wholeWidth(): number {
    return this.width | 0;
  }
  widthOr(fallback: number): number {
    return this.width ?? fallback;
  }
  heading(): string {
    return this.title + "!";
  }
  titleLength(): number {
    return this.title.length;
  }
  ownerName(): string {
    return this.owner.first;
  }
  rowCount(): number {
    return this.rows.length;
  }
  change(): number {
    return this.onChange();
  }
  state(): string {
    return this.ready ? "ready" : "not ready";
  }
}

function all(label: string, sheet: Sheet): void {
  show(label + " width", () => sheet.width);
  show(label + " title", () => sheet.title);
  show(label + " owner", () => sheet.owner);
  show(label + " rows", () => sheet.rows);
  show(label + " onChange", () => typeof sheet.onChange);
  show(label + " ready", () => sheet.ready);
  show(label + " keys", () => Object.keys(sheet).join());
  show(label + " width in sheet", () => "width" in sheet);
  show(label + " own width", () => Object.hasOwn(sheet, "width"));
  show(label + " JSON", () => JSON.stringify(sheet));
  show(label + " area", () => sheet.area());
  show(label + " widthPlusOne", () => sheet.widthPlusOne());
  show(label + " wholeWidth", () => sheet.wholeWidth());
  show(label + " widthOr", () => sheet.widthOr(7));
  show(label + " heading", () => sheet.heading());
  show(label + " titleLength", () => sheet.titleLength());
  show(label + " ownerName", () => sheet.ownerName());
  show(label + " rowCount", () => sheet.rowCount());
  show(label + " change", () => sheet.change());
  show(label + " state", () => sheet.state());
}

const empty = new Sheet();
all("empty", empty);
const filled = new Sheet();
filled.setUp();
all("filled", filled);
empty.setUp();
all("filled late", empty);

let later!: number;
let laterText!: string;
let laterOwner!: Person;
show("a variable marked the same way", () => later);
show("plus one", () => later + 1);
show("a string variable", () => laterText);
show("its length", () => laterText.length);
show("an object variable", () => laterOwner);
show("its member", () => laterOwner.first);
later = 4;
show("assigned", () => later + 1);

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
  declare width: number;
  declare title: string;
  declare owner: Person;
  declare rows: number[];
  declare onChange: () => number;
  declare ready: boolean;
  height: number = 2;
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
  hasWidth(): boolean {
    return this.width !== undefined;
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

const sheet = new Sheet();
show("width", () => sheet.width);
show("title", () => sheet.title);
show("owner", () => sheet.owner);
show("rows", () => sheet.rows);
show("onChange", () => sheet.onChange);
show("ready", () => sheet.ready);
show("height", () => sheet.height);
show("keys", () => Object.keys(sheet).join());
show("width in sheet", () => "width" in sheet);
show("JSON", () => JSON.stringify(sheet));
show("area", () => sheet.area());
show("widthPlusOne", () => sheet.widthPlusOne());
show("wholeWidth", () => sheet.wholeWidth());
show("widthOr", () => sheet.widthOr(7));
show("hasWidth", () => sheet.hasWidth());
show("heading", () => sheet.heading());
show("titleLength", () => sheet.titleLength());
show("ownerName", () => sheet.ownerName());
show("rowCount", () => sheet.rowCount());
show("change", () => sheet.change());
show("state", () => sheet.state());
show("width++", () => sheet.width++);
show("width after ++", () => sheet.width);
show("keys after ++", () => Object.keys(sheet).join());

const filled = new Sheet();
filled.width = 3;
filled.title = "t";
filled.owner = new Person();
filled.rows = [1];
filled.onChange = () => 9;
filled.ready = true;
show("filled area", () => filled.area());
show("filled heading", () => filled.heading());
show("filled ownerName", () => filled.ownerName());
show("filled rowCount", () => filled.rowCount());
show("filled change", () => filled.change());
show("filled state", () => filled.state());
show("filled keys", () => Object.keys(filled).join());

function areaOf(s: Sheet): number {
  return s.width * s.height;
}
let sum = 0;
for (let i = 0; i < 2000; i++) sum += areaOf(filled);
show("2000 filled sheets", () => sum);
show("then an empty one", () => areaOf(new Sheet()));
show("then a filled one", () => areaOf(filled));

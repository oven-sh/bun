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
}

abstract class Page {
  abstract title: string;
  abstract lines: string[];
  abstract author: Person;
  seen: string[] = [];
  heading: string;
  constructor() {
    this.heading = this.titleNow() + "!";
    this.note("title", () => this.title);
    this.note("the length of the title", () => this.title.length);
    this.note("the title in capitals", () => this.title.toUpperCase());
    this.note("lines", () => this.lines);
    this.note("the number of lines", () => this.lines.length);
    this.note("lines iterated", () => [...this.lines].length);
    this.note("author", () => this.author);
    this.note("the name of the author", () => this.author.first);
  }
  titleNow(): string {
    return this.title;
  }
  note(label: string, run: () => unknown): void {
    try {
      const value = run();
      this.seen.push(label + " " + typeof value + " " + String(value));
    } catch (error) {
      this.seen.push(label + " threw " + (error instanceof TypeError ? "TypeError" : "another error"));
    }
  }
}

class ByFields extends Page {
  title: string = "fields";
  lines: string[] = ["one", "two"];
  author: Person = new Person();
}

class ByGetters extends Page {
  get title(): string {
    return "getters";
  }
  get lines(): string[] {
    return ["only"];
  }
  get author(): Person {
    return new Person();
  }
}

abstract class Strict {
  abstract title: string;
  width: number;
  constructor() {
    this.width = this.measure();
  }
  measure(): number {
    return this.title.length;
  }
}

class StrictByField extends Strict {
  title: string = "late";
}

class StrictByGetter extends Strict {
  get title(): string {
    return "early";
  }
}

const byGetters = new ByGetters();
show("getters: heading", () => byGetters.heading);
for (const line of byGetters.seen) console.log("getters: " + line);

const byFields = new ByFields();
show("fields: heading", () => byFields.heading);
for (const line of byFields.seen) console.log("fields: " + line);
show("fields: now", () => [byFields.title, byFields.lines, byFields.author.first]);
show("fields: keys", () => Object.keys(byFields));

show("a constructor that needs it: by a getter", () => new StrictByGetter().width);
show("a constructor that needs it: by a field", () => new StrictByField().width);
show("2000 of each", () => {
  let made = 0;
  let failed = 0;
  for (let i = 0; i < 2000; i++) {
    made += new StrictByGetter().width;
    try {
      made += new StrictByField().width;
    } catch {
      failed++;
    }
  }
  return [made, failed];
});

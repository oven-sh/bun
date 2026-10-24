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

class Registry {
  declare static count: number;
  declare static title: string;
  declare static items: string[];
  declare static make: () => Registry;
  static made: number = 1;
  static next(): number {
    return Registry.count + 1;
  }
  static viaThis(): number {
    return this.count + this.made;
  }
  static heading(): string {
    return Registry.title + "!";
  }
}

class Sub extends Registry {
  static own: number = 2;
}

show("read", () => Registry.count);
show("typeof", () => typeof Registry.count);
show("plus one", () => Registry.count + 1);
show("in a static method", () => Registry.next());
show("by this in a static method", () => Registry.viaThis());
show("the text", () => Registry.title);
show("the length of the text", () => Registry.title.length);
show("the text in a static method", () => Registry.heading());
show("the list", () => Registry.items);
show("a push into the list", () => Registry.items.push("x"));
show("the function", () => Registry.make);
show("the function called", () => Registry.make());
show("through the subclass", () => [Sub.count, Sub.title, Sub.made]);
show("in", () => ["count" in Registry, "made" in Registry]);
show("keys", () => Object.keys(Registry));
show("own names", () => Object.getOwnPropertyNames(Registry).sort());

Registry.count = 5;
show("after a store", () => [Registry.count, Registry.next(), Registry.viaThis(), Sub.count, Object.keys(Registry)]);
Sub.count = 7;
show("after a store on the subclass", () => [Registry.count, Sub.count, Sub.next(), Sub.viaThis(), Object.keys(Sub)]);
Registry.count++;
show("after ++", () => [Registry.count, Sub.count]);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += Registry.next();
show("2000 calls", () => sum);

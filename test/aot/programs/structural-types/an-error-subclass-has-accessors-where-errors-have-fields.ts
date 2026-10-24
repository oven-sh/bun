const log: string[] = [];

class Computed extends Error {
  code = 7;
  get message(): string {
    log.push("get message");
    return "computed " + this.code;
  }
  set message(value: string) {
    log.push("set message " + value);
  }
  get name(): string {
    log.push("get name");
    return "ComputedName";
  }
}

class Plain extends Error {
  code = 7;
}

class Renamed extends Error {
  name = "RenamedField";
}

class Spoken extends Error {
  toString(): string {
    return "spoken: " + this.message;
  }
}

function messageOf(e: Error): string {
  return e.message;
}

function text(e: Error): string {
  return String(e) + " | " + `${e}` + " | " + e.name + ": " + e.message;
}

function store(e: Error, value: string): string {
  try {
    e.message = value;
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
  return e.message;
}

function round(label: string, make: () => Error): void {
  log.length = 0;
  console.log(label + ": " + messageOf(make()) + " || " + text(make()) + " || stored " + store(make(), "new") + " || own " + Object.hasOwn(make(), "message") + " " + Object.hasOwn(make(), "name") + " keys " + Object.keys(make()).join() + " [" + log.length + "]");
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += messageOf(new Plain("p")).length + messageOf(new Error("e")).length;
console.log("2000 honest: " + warm);

round("an error", () => new Error("given"));
round("a plain subclass", () => new Plain("given"));
round("accessors, a message given", () => new Computed("given"));
round("accessors, no message given", () => new Computed());
round("a name field", () => new Renamed("given"));
round("its own toString", () => new Spoken("given"));

const own = new Plain("first");
Object.defineProperty(own, "message", { get: () => "own getter", configurable: true });
round("an own getter over the field", () => own);

Plain.prototype.name = "PatchedName";
round("the name stored on the subclass's prototype", () => new Plain("given"));
Reflect.deleteProperty(Plain.prototype, "name");
round("removed", () => new Plain("given"));

function caught(make: () => Error): string {
  try {
    throw make();
  } catch (error) {
    return error instanceof Error ? error.constructor.name + " " + error.name + " " + error.message : typeof error;
  }
}

console.log("thrown and caught: " + [() => new Error("e"), () => new Plain("p"), () => new Computed("c"), () => new Computed(), () => new Renamed("r")].map(caught).join(" | "));

export {};

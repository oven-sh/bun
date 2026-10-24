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

class Jumps {
  height: number = 2;
  jump(): number {
    return this.height * 10;
  }
}

class Swims {
  depth: number = 3;
  swim(): number {
    return this.depth * 100;
  }
}

interface Frog extends Jumps, Swims {}
class Frog {
  name: string = "frog";
}

function copyMethods(target: { prototype: object }, source: { prototype: object }): void {
  for (const name of Object.getOwnPropertyNames(source.prototype)) {
    if (name === "constructor") continue;
    const found = Object.getOwnPropertyDescriptor(source.prototype, name);
    if (found) Object.defineProperty(target.prototype, name, found);
  }
}

function jumpOf(j: Jumps): number {
  return j.jump();
}

function swimOf(s: Swims): number {
  return s.swim();
}

show("honest callers", () => [jumpOf(new Jumps()), swimOf(new Swims())]);

const early = new Frog();
show("before anything is copied: jump", () => early.jump());
show("before anything is copied: typeof", () => [typeof early.jump, typeof early.swim, typeof early.height, typeof early.depth]);

copyMethods(Frog, Jumps);

const frog = new Frog();
show("the copied method runs without its field", () => frog.jump());
show("through the function the honest ones use", () => jumpOf(frog));
show("the earlier instance has it too", () => early.jump());
show("the field of the copied one", () => frog.height);
show("the method that was not copied", () => frog.swim());
show("through the function the honest ones use", () => swimOf(frog));
show("the field of that one", () => frog.depth);
show("keys", () => Object.keys(frog));
show("names of the prototype", () => Object.getOwnPropertyNames(Frog.prototype));
show("instanceof", () => [frog instanceof Jumps, frog instanceof Swims, frog instanceof Frog]);

frog.height = 5;
show("after the field is stored", () => [frog.jump(), jumpOf(frog), Object.keys(frog)]);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += jumpOf(i % 2 === 0 ? new Jumps() : frog);
show("2000 calls with both kinds", () => sum);
show("a fresh one", () => jumpOf(new Frog()));
show("honest callers again", () => [jumpOf(new Jumps()), swimOf(new Swims())]);

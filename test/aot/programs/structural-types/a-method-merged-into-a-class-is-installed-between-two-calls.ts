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

interface Robot {
  beep(): string;
  charge: number;
}
class Robot {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
  twice(): string {
    return this.beep() + this.beep();
  }
}

function beepOf(robot: Robot): string {
  return robot.beep();
}

function attempt(robot: Robot): string {
  try {
    return beepOf(robot);
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "another error";
  }
}

const first = new Robot(1);
show("before", () => [attempt(first), typeof first.beep, "beep" in first]);

show("a loop in which it appears and goes away", () => {
  const seen: string[] = [];
  const optional: { beep?: () => string } = Robot.prototype;
  for (let i = 0; i < 6; i++) {
    if (i === 2) {
      Robot.prototype.beep = function (this: Robot): string {
        return "beep" + this.id;
      };
    }
    if (i === 4) delete optional.beep;
    seen.push(attempt(first));
  }
  return seen;
});

Robot.prototype.beep = function (this: Robot): string {
  return "b" + this.id;
};
let letters = 0;
for (let i = 0; i < 2000; i++) letters += beepOf(new Robot(i % 10)).length + new Robot(1).twice().length;
show("2000 calls while it is there", () => letters);

const gone: { beep?: () => string } = Robot.prototype;
delete gone.beep;
show("after it is deleted", () => [attempt(first), attempt(new Robot(2)), typeof first.beep]);
show("in the method of the class", () => first.twice());

Robot.prototype.charge = 50;
show("a number on the prototype", () => [first.charge, first.charge + 1, Object.keys(first), "charge" in first]);
first.charge -= 1;
show("stored on one instance", () => [first.charge, new Robot(3).charge, Object.keys(first)]);

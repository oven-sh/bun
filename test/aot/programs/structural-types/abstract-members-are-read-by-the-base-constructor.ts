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

const log: string[] = [];

abstract class Shape {
  abstract readonly sides: number;
  abstract name: string;
  abstract area(): number;
  abstract get corners(): number;
  summary: string;
  doubled: number;
  constructor() {
    this.summary = this.describe();
    this.doubled = this.twice();
  }
  describe(): string {
    return typeof this.sides + " " + this.sides + " " + typeof this.name + " " + this.name + " " + this.corners;
  }
  twice(): number {
    return this.sides * 2;
  }
  safeArea(): string {
    try {
      return String(this.area());
    } catch (error) {
      return "threw";
    }
  }
}

class Square extends Shape {
  readonly sides: number = 4;
  name: string = "square";
  side: number = 3;
  area(): number {
    return this.side * this.side;
  }
  get corners(): number {
    return this.sides;
  }
}

class Fixed extends Shape {
  get sides(): number {
    return 3;
  }
  get name(): string {
    return "fixed";
  }
  set name(value: string) {
    log.push("name set to " + value);
  }
  area(): number {
    return 1;
  }
  get corners(): number {
    return 3;
  }
}

class Early extends Shape {
  readonly sides: number = 5;
  name: string = "early";
  areaSeen: string;
  points: number[] = [1, 2];
  constructor() {
    super();
    this.areaSeen = this.safeArea();
  }
  area(): number {
    return this.points.length;
  }
  get corners(): number {
    return this.points.length;
  }
  describe(): string {
    try {
      return super.describe();
    } catch (error) {
      return "threw " + (error instanceof Error ? error.constructor.name : typeof error);
    }
  }
}

const square = new Square();
show("square summary", () => square.summary);
show("square doubled", () => square.doubled);
show("square describe now", () => square.describe());
show("square twice now", () => square.twice());
show("square area", () => square.area());
show("square keys", () => Object.keys(square).join());

const fixed = new Fixed();
show("fixed summary", () => fixed.summary);
show("fixed doubled", () => fixed.doubled);
fixed.name = "other";
show("fixed name", () => fixed.name);
show("log", () => log.join());
show("fixed keys", () => Object.keys(fixed).join());

const early = new Early();
show("early summary", () => early.summary);
show("early doubled", () => early.doubled);
show("early area seen", () => early.areaSeen);

const shapes: Shape[] = [square, fixed, early];
let total = 0;
for (const shape of shapes) total += shape.doubled;
show("all doubled added", () => total);
show("sides", () => shapes.map(s => s.sides).join());

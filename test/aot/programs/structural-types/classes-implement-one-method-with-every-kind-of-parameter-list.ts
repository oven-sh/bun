function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

interface Shape {
  area(scale?: number): string;
}

class NoParameter implements Shape {
  area(): string {
    return "none, " + arguments.length + " given";
  }
}

class Optional implements Shape {
  area(scale?: number): string {
    return "optional " + text(scale) + ", " + arguments.length + " given";
  }
}

class Defaulted implements Shape {
  side = 3;
  area(scale: number = this.side): string {
    return "defaulted " + text(scale) + ", doubled " + text(scale * 2) + ", " + arguments.length + " given";
  }
}

class Rest implements Shape {
  area(...all: (number | undefined)[]): string {
    return "rest of " + all.length + " " + text(all[0]);
  }
}

class Needed implements Shape {
  area(scale: number): string {
    return "required " + text(scale) + ", doubled " + text(scale * 2) + ", whole " + text(scale | 0);
  }
}

class Hidden implements Shape {
  area(scale?: number, unit?: string): string {
    return "hidden " + text(scale) + " " + text(unit) + ", " + arguments.length + " given";
  }
}

class TwoDefaults implements Shape {
  area(scale: number = 1, offset: number = scale + 1): string {
    return "two defaults " + text(scale) + " " + text(offset);
  }
}

class Arrow implements Shape {
  area = (scale?: number): string => "arrow " + text(scale);
}

class Getter implements Shape {
  get area(): (scale?: number) => string {
    return scale => "getter " + text(scale);
  }
}

class Inherited extends Defaulted {
  side = 30;
}

class Overriding extends Defaulted {
  area(scale: number = 7): string {
    return "overriding, " + super.area(scale) + " | " + super.area();
  }
}

const literal: Shape = {
  area(scale = 11) {
    return "literal " + text(scale);
  },
};

const shapes: Shape[] = [
  new NoParameter(), new Optional(), new Defaulted(), new Rest(), new Needed(), new Hidden(),
  new TwoDefaults(), new Arrow(), new Getter(), new Inherited(), new Overriding(), literal,
];

function none(shape: Shape): string {
  return shape.area();
}
function explicit(shape: Shape): string {
  return shape.area(undefined);
}
function given(shape: Shape): string {
  return shape.area(2);
}
function spread(shape: Shape, parts: [number?]): string {
  return shape.area(...parts);
}

let warm = 0;
const usual = new Defaulted();
for (let i = 0; i < 2000; i++) warm += none(usual).length + explicit(usual).length + given(usual).length;
console.log("2000 rounds with one class: " + warm);

for (const shape of shapes) {
  const name = shape === literal ? "literal" : shape.constructor.name;
  console.log(name + ", area(): " + none(shape));
  console.log(name + ", area(undefined): " + explicit(shape));
  console.log(name + ", area(2): " + given(shape));
  console.log(name + ", area(...[]): " + spread(shape, []));
  console.log(name + ", area(...[undefined]): " + spread(shape, [undefined]));
  console.log(name + ", length " + shape.area.length);
}

interface Wider {
  area(scale: number, unit: number, more: number): string;
}
const wider: Wider[] = [new NoParameter(), new Optional(), new Defaulted(), new Rest(), new Needed(), new TwoDefaults()];
for (const shape of wider) console.log(shape.constructor.name + ", three given: " + shape.area(1, 2, 3));

const narrow: Shape = new Hidden();
const forgetful: { area(scale: number, unit: number): string } = narrow;
console.log("a number arrives in the hidden text parameter: " + forgetful.area(1, 2));
console.log("the usual one again: " + none(usual));

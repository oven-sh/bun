class First {
  static label = "first label";
  static make(): string {
    return "first make, this is " + this.name + ", " + this.label;
  }
}

class Second {
  static label = "second label";
  static make(): string {
    return "second make, this is " + this.name + ", " + this.label;
  }
}

class Child extends First {
  static make(): string {
    return "child > " + super.make();
  }
  static labelAbove(): string {
    return super.label;
  }
}

class Plain extends First {}

function makeWith(c: typeof First): string {
  return c.make();
}

function round(label: string): void {
  console.log(label + ": " + Child.make() + " | " + makeWith(Child) + " | " + Child.labelAbove() + " | " + Child.label);
  console.log(label + ", the plain subclass: " + Plain.make() + " | " + makeWith(Plain) + " | " + Plain.label + " | own " + Object.hasOwn(Plain, "make"));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += Child.make().length + makeWith(Plain).length + Child.labelAbove().length;
console.log("2000 honest: " + warm);
round("before");

const original = First.make;
First.make = function () {
  return "replaced, this is " + this.name;
};
round("the parent's static method replaced");

First.make = () => "an arrow";
round("by an arrow");

First.make = original;
First.label = "first label, stored to";
round("put back, and the label stored to");

Plain.make = () => "own of the plain subclass";
round("the plain subclass covers it");
const view: { make?: () => string } = Plain;
delete view.make;
round("uncovered");

Object.setPrototypeOf(Child, Second);
Object.setPrototypeOf(Plain, Second);
round("both classes hang under the second class");

Object.setPrototypeOf(Child, First);
Object.setPrototypeOf(Plain, First);
round("restored");

export {};

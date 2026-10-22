class First {
  tag = "t";
  greet(): string {
    return "first " + this.tag;
  }
  get title(): string {
    return "first title";
  }
}

class Second {
  tag = "unused";
  greet(): string {
    return "second " + this.tag;
  }
  get title(): string {
    return "second title";
  }
}

class Child extends First {
  greet(): string {
    return "child > " + super.greet();
  }
  get title(): string {
    return "child > " + super.title;
  }
  inherited(): string {
    return super.greet() + " / " + super.title;
  }
}

class Plain extends First {}

function greet(f: First): string {
  return f.greet() + " | " + f.title;
}

const child = new Child();
const plain = new Plain();

function round(label: string): void {
  console.log(label + ": " + greet(child) + " | " + child.inherited() + " || " + greet(plain) + " || " + (child instanceof First) + " " + (child instanceof Second) + " " + (plain instanceof First));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += greet(child).length + child.inherited().length + greet(plain).length;
console.log("2000 honest: " + warm);
round("before");

Object.setPrototypeOf(Child.prototype, Second.prototype);
round("the child's prototype hangs under the second class");

Object.setPrototypeOf(Plain.prototype, Second.prototype);
round("the plain subclass too");

Object.setPrototypeOf(Child.prototype, First.prototype);
Object.setPrototypeOf(Plain.prototype, First.prototype);
round("both back");

const between = Object.create(First.prototype, {
  greet: {
    value(this: First): string {
      return "between " + this.tag;
    },
    configurable: true,
  },
});
Object.setPrototypeOf(Child.prototype, between);
Object.setPrototypeOf(Plain.prototype, between);
round("a new link in the middle of the chain");

Reflect.deleteProperty(between, "greet");
round("the link loses its method");

Object.setPrototypeOf(Child.prototype, null);
try {
  round("no parent at all");
} catch (error) {
  console.log("no parent at all: threw " + (error instanceof Error ? error.constructor.name : typeof error));
}
Object.setPrototypeOf(Child.prototype, First.prototype);
Object.setPrototypeOf(Plain.prototype, First.prototype);
round("restored");

export {};

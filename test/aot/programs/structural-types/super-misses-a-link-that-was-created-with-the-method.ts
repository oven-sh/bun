class First {
  greet(): string {
    return "first";
  }
}

class Child extends First {
  greet(): string {
    return "child > " + super.greet();
  }
}

const child = new Child();
console.log(child.greet());
const between = Object.create(First.prototype, { greet: { value: () => "between" } });
Object.setPrototypeOf(Child.prototype, between);
console.log(child.greet());

export {};

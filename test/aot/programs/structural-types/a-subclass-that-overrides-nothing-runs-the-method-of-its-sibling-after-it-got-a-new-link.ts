class First {
  greet(): string {
    return "first";
  }
}

class Child extends First {
  greet(): string {
    return "child";
  }
}

class Plain extends First {}

function greet(f: First): string {
  return f.greet();
}

const child = new Child();
const plain = new Plain();
console.log(greet(child) + " | " + greet(plain));
Object.setPrototypeOf(Plain.prototype, Object.create(First.prototype, { greet: { value: () => "between" } }));
console.log(greet(child) + " | " + greet(plain));

export {};

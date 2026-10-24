class First {
  greet(): string {
    return "first";
  }
}

class Plain extends First {}

const plain = new Plain();
console.log(plain.greet());
const between = Object.create(First.prototype, { greet: { value: () => "between" } });
Object.setPrototypeOf(Plain.prototype, between);
console.log(plain.greet());

export {};

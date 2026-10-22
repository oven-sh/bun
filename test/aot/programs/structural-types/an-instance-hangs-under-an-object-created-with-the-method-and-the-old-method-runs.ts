class First {
  greet(): string {
    return "first";
  }
}

const plain = new First();
console.log(plain.greet());
Object.setPrototypeOf(plain, Object.create(First.prototype, { greet: { value: () => "between" } }));
console.log(plain.greet());

export {};

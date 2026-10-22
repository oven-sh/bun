class First {
  get title(): string {
    return "first";
  }
  static make(): string {
    return "first make";
  }
}

class Plain extends First {}

const plain = new Plain();
console.log(plain.title + " " + Plain.make());
Object.setPrototypeOf(Plain.prototype, Object.create(First.prototype, { title: { get: () => "between" } }));
Object.setPrototypeOf(Plain, Object.create(First, { make: { value: () => "between make" } }));
console.log(plain.title + " " + Plain.make());

export {};

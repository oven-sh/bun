class First {
  greet(): string {
    return "first";
  }
}
class Plain extends First {}
const plain = new Plain();
console.log("zq " + plain.greet());
Object.setPrototypeOf(Plain.prototype, Object.create(First.prototype, { greet: { value: () => "between" } }));
console.log("zq " + plain.greet());

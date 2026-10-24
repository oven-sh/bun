class Stack extends Array<number> {
  limit: number = 3;
  top(): number {
    return this[this.length - 1];
  }
}
const stack = new Stack();
stack.push(1, 2);
console.log("top " + stack.top());

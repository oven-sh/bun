function lengthOf(value: string | number[]): number {
  if (Array.isArray(value)) return value.length;
  return -value.length;
}

function firstOf(value: string | number[] | undefined): number | string {
  if (!Array.isArray(value)) return value === undefined ? "none" : value;
  return value[0];
}

class Stack extends Array<number> {
  top(): number {
    return this[this.length - 1];
  }
}

function describe(value: Stack | string): string {
  return Array.isArray(value) ? `list of ${value.length}, top ${value.top()}` : `text ${value}`;
}

const many = process.argv.length > 100;
console.log(lengthOf(many ? "x" : [1, 2, 3]), lengthOf(many ? [1] : "four"));
console.log(firstOf(many ? "x" : [7, 8]), firstOf(many ? [1] : "text"), firstOf(undefined));
const stack = new Stack();
stack.push(4, 5);
console.log(describe(stack), describe("plain"));
console.log(ArrayBuffer.isView(many ? "x" : new Uint8Array(2)), ArrayBuffer.isView(many ? new DataView(new ArrayBuffer(1)) : "x"));

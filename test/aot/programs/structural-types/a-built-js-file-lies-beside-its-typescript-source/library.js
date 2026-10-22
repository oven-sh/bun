console.log("library.js ran");

export const count = "one";

export function label() {
  return 42;
}

export class Point {
  constructor(x, y) {
    this.y = String(y);
    this.x = String(x);
    this.old = true;
  }
  sum() {
    return "an old build: " + this.x + this.y;
  }
}

export function total(numbers) {
  return numbers.join("+");
}

namespace Settings {
  export const early: string = typeof peek() + " " + peek();
  export const depth: number = 3;
  export function peek(): number {
    return depth;
  }
}
console.log("early: " + Settings.early);
console.log("late: " + typeof Settings.peek() + " " + Settings.peek());

// The expected output is what tsc emits and what `bun build` prints: a function of the namespace reads the member of the namespace object. `bun run` puts the value of the constant in place of the name.

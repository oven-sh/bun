function times(n: number): string {
  return n + " times";
}

export class Wheel {
  turn(): string {
    return "wheel turns " + times(2);
  }
}

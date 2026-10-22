export function first(n: number): number {
  return n + 1;
}

export function second(n: number): string {
  return "second " + n;
}

export const third = (n: number): number => n * 3;

export class Fourth {
  constructor(public n: number) {}
  get(): number {
    return this.n + 4;
  }
}

export let fifth = 5;

export function setFifth(n: number): void {
  fifth = n;
}

export default function sixth(n: number): number {
  return n + 6;
}

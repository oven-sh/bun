export let y = 2;
export let x = 1;
export let label = "values";

export function move(by: number): void {
  x += by;
  y += by;
}

export function rename(to: string): void {
  label = to;
}

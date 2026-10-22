export let count = 1;
export let label = "start";
export let origin = { x: 1, y: 2 };
export let step = (n: number): number => n + 1;
export let list = [1, 2];
export let maybe: number | undefined;
export var old = 1;

export function bump(): void {
  count++;
  old += 2;
}

export function rename(to: string): void {
  label = to;
}

export function move(): void {
  origin = { x: origin.x + 1, y: origin.y + 1 };
}

export function faster(): void {
  step = n => n + 100;
}

export function grow(): void {
  list = [...list, list.length + 1];
}

export function fill(): void {
  maybe = 7;
}

export class Setter {
  set(n: number): void {
    count = n;
  }
}

export const later = (): void => {
  queueMicrotask(() => {
    count = -1;
  });
};

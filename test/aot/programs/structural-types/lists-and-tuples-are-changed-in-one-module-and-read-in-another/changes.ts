export function grow(list: unknown[], length: number): void {
  list.length = length;
}

export function drop(list: unknown[], index: number): void {
  delete list[index];
}

export function turn(list: unknown[]): void {
  list.reverse();
}

export function shorten(list: unknown[]): void {
  list.pop();
}

export const shared: number[] = [1, 2, 3];
export const entry: [number, string] = [1, "a"];

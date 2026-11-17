let count = 0;
// Every call returns a new number, so the output shows which calls the compiler cached.
export function next(): number {
  return ++count;
}
export function log(text: string): void {
  console.log("log", text);
}
export const enum Size {
  Small = 1,
  Large = 2,
}
export enum Color {
  Red = "red",
  Blue = "blue",
}
export const LIMIT = 3;

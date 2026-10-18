export function imported(value: number): number {
  return value + 1;
}
export const constant = (value: number): number => value + 2;
export let reassigned = (value: number): number => value + 3;
export function reassign(): void {
  reassigned = value => value + 30;
}

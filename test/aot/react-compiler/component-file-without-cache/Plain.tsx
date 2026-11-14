export function Plain(): number {
  return 1;
}

export function total(numbers: number[]): number {
  let sum = 0;
  for (const number of numbers) sum += number;
  return sum;
}

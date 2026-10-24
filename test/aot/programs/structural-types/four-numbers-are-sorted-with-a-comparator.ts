function sorted(numbers: number[]): number[] {
  return numbers.sort((a, b) => a - b);
}

console.log("sorted", sorted([3, 2, 1, 0]).join());

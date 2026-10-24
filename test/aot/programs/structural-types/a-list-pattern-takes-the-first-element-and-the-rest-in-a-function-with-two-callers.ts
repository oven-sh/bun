function total(list: number[]): number {
  const [first, ...rest] = list;
  return first + rest.length;
}
console.log(total([1, 2]));
console.log(total([3]));
export {};

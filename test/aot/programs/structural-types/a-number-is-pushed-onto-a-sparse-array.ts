function sparse(): number[] {
  const numbers: number[] = [];
  numbers[1000000] = 3;
  return numbers;
}
const numbers = sparse();
console.log("zzstart", numbers.length);
console.log("zzresult", numbers.push(4), numbers.length);

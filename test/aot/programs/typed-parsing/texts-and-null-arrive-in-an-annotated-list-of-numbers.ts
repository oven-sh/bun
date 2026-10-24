const list: number[] = JSON.parse('[1,"2",null,3.5,true,[4],{"a":5}]');

function sum(values: number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
function kinds(values: number[]): string {
  return values.map(value => typeof value).join();
}
function numbersOnly(values: number[]): number {
  let count = 0;
  for (const value of values) if (typeof value === "number") count++;
  return count;
}

console.log(list.length);
console.log(sum(list.slice(0, 1)), sum(list.slice(0, 2)), sum(list.slice(0, 3)), sum(list.slice(2, 4)), sum(list.slice(3, 5)));
console.log(kinds(list));
console.log(numbersOnly(list));
console.log(list[1] + 1, list[2] + 1, list[4] + 1, list[5] + 1);
console.log(list[1] === 2, list[2] === 0, list[2] === null, list[4] === 1);
console.log(list.indexOf(2), list.includes(2), list.indexOf(3.5), list.includes(1));
console.log(list.map(value => value * 2).join());
console.log(list.filter(value => value > 1).length);
console.log(Math.max(...list.slice(0, 2)), Math.max(...list.slice(0, 3)), Math.min(...list.slice(0, 5)));
console.log(JSON.stringify(list));

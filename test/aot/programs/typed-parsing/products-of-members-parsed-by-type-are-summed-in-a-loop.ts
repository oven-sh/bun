interface Line {
  count: number;
  price: number;
}
function total(lines: Line[]): number {
  let sum = 0;
  for (const line of lines) sum += line.count * line.price;
  return sum;
}
console.log(total(JSON.parse<Line[]>('[{"count":2,"price":2.5}]')));

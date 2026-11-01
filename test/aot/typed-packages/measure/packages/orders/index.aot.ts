interface Line {
  price: number;
  count: number;
}
interface Order {
  lines: Line[];
}
export function total(json: string): number {
  const order: Order = JSON.parse(json);
  let sum = 0;
  for (const line of order.lines) sum += line.price * line.count;
  return sum;
}

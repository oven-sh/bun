export function total(json) {
  const order = JSON.parse(json);
  let sum = 0;
  for (const line of order.lines) sum += line.price * line.count;
  return sum;
}

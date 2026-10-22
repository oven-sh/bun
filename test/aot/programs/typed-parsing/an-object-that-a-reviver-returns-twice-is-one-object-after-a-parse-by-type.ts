interface Order {
  lines: { count: number }[];
}
const shared = { count: 5 };
const order = JSON.parse<Order>('{"lines":[{"count":1},{"count":2}]}', (key, value) => (key === "0" || key === "1" ? shared : value));
console.log(order.lines[0] === order.lines[1]);
console.log(order.lines[0] === shared);
shared.count = 6;
console.log(order.lines[0].count, order.lines[1].count);

// The work of the route POST /shops/:shop/orders without a server: the body is parsed anew at each turn, checked by zod and priced (./shared placeOrder).
// More than half of what that route costs more than it should was found here, in a program that builds in seconds and can be stepped one instruction at a time.
//   order-only order <turns>     3,000 turns to warm, process.umask(), <turns> turns, process.umask(): the two calls are marks for whoever counts or steps between them
//   order-only none <turns>      the same without the work
// ORDER_BODY: another body. It is read from the environment so that no compiler knows the text.
import { placeOrder } from "./shared";

const text = process.env.ORDER_BODY ?? `{"customer":{"id":4711,"name":"Zoë Müller","email":"zoe@example.com"},"items":[{"sku":"SKU-1000","quantity":1,"unitCents":199},{"sku":"SKU-1037","quantity":3,"unitCents":549},{"sku":"SKU-1074","quantity":5,"unitCents":899},{"sku":"SKU-1111","quantity":2,"unitCents":1249},{"sku":"SKU-1148","quantity":4,"unitCents":1599},{"sku":"SKU-1185","quantity":1,"unitCents":1949},{"sku":"SKU-1222","quantity":3,"unitCents":2299},{"sku":"SKU-1259","quantity":5,"unitCents":2649},{"sku":"SKU-1296","quantity":2,"unitCents":2999},{"sku":"SKU-1333","quantity":4,"unitCents":3349}],"coupon":"TENOFF"}`;
const cases: Record<string, () => number> = {
  none: () => 0,
  order: () => (placeOrder("west", JSON.parse(text)) ? 1 : 0),
};
const turn = cases[process.argv[2] ?? "order"]!;
const turns = Number(process.argv[3] ?? "10");
let placed = 0;
for (let i = 0; i < 3000; i++) placed += turn();
process.umask();
for (let i = 0; i < turns; i++) placed += turn();
process.umask();
console.log(placed);

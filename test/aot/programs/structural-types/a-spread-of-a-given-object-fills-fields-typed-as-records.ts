interface Address { street: string; city: string }
interface Customer { id: number; name: string; address: Address }
interface Order { id: string; customer: Customer; shipping: Address; billing?: Address; tags: string[]; note: string | null }
interface Priced extends Order { total: number }

function price(order: Order): Priced { return { ...order, total: order.tags.length + order.customer.id }; }
function relabel(order: Order, id: string): Order { return { ...order, id }; }
function cityOf(order: Order): string { return order.shipping.city + "/" + order.customer.address.city + "/" + (order.billing?.city ?? "none"); }
function describe(order: Order): string { return [cityOf(order), Object.keys(order).join("+"), JSON.stringify(order), "billing" in order, order.customer.name.length].join(" "); }

const written: Order = { id: "w", customer: { id: 1, name: "Ann", address: { street: "1 A", city: "Ayr" } }, shipping: { street: "2 B", city: "Bath" }, tags: ["x"], note: null };
const make = new Function("n", `
  const address = {}; address.street = n + " C"; address.city = "Cork" + n;
  const customer = {}; customer.id = n; customer.name = "Cy" + n; customer.address = address;
  const order = {}; order.id = "g" + n; order.customer = customer; order.shipping = address;
  if (n % 3 === 0) order.billing = { city: "Deal", street: "4 D" };
  order.tags = n % 2 ? [] : ["a", "b"]; order.note = n % 5 ? null : "n";
  return order;`) as (n: number) => Order;
const call = new Function("f", "a", "b", "return f(a, b)") as <A, B, R>(f: (a: A, b: B) => R, a: A, b?: B) => R;

const seen = new Map<string, number>();
const note = (line: string) => seen.set(line, (seen.get(line) ?? 0) + 1);
for (let turn = 0; turn < 400; turn++) {
  const given = make(turn % 6);
  const parsed = JSON.parse(JSON.stringify(given)) as Order;
  for (const order of [written, given, parsed]) {
    const priced = call(price, order);
    note(describe(priced) + " " + priced.total);
    const again = price(relabel(priced, "r"));
    note(describe(again) + " " + again.total);
    again.shipping = written.shipping;
    again.customer = given.customer;
    if (turn % 7 === 0) delete again.billing;
    note(describe(again));
  }
}
for (const [line, count] of seen) console.log(count, line);

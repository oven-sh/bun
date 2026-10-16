// What every server under ./app and ./tanstack must answer, computed from the rules alone. No server is asked.

const cities = ["Lisbon", "Osaka", "Denver", "Nairobi", "Oslo"];

function profile(id: number) {
  return {
    id,
    name: `User ${id}`,
    email: `user${id}@example.com`,
    age: 20 + (id % 50),
    active: id % 2 === 0,
    score: id + 0.5,
    role: id % 10 === 0 ? "admin" : "member",
    city: cities[id % 5],
    createdAt: `2026-01-${String(1 + (id % 28)).padStart(2, "0")}T00:00:00.000Z`,
    visits: id * 37,
  };
}

const products = Array.from({ length: 50 }, (_, index) => {
  const id = index + 1;
  return { id, title: `Product ${id}`, priceCents: 199 + id * 350, stock: id % 7 };
});

const order = {
  customer: { id: 4711, name: "Zoë Müller", email: "zoe@example.com" },
  items: Array.from({ length: 10 }, (_, n) => ({ sku: `SKU-${1000 + 37 * n}`, quantity: 1 + ((2 * n) % 5), unitCents: 199 + 350 * n })),
  coupon: "TENOFF",
};

const lines = order.items.map(item => ({ sku: item.sku, lineCents: item.quantity * item.unitCents }));
const subtotalCents = lines.reduce((sum, line) => sum + line.lineCents, 0);
const discountCents = Math.floor(subtotalCents / 10);
const taxCents = Math.floor(((subtotalCents - discountCents) * 8) / 100);
const receipt = JSON.stringify({
  shop: "west",
  customerId: 4711,
  lines,
  subtotalCents,
  discountCents,
  taxCents,
  totalCents: subtotalCents - discountCents + taxCents,
});

export interface Route {
  name: string;
  method: "GET" | "POST";
  path: string;
  type: string;
  request?: string;
  answer: string;
}

export const routes: Route[] = [
  { name: "text", method: "GET", path: "/text", type: "text/plain", answer: "Hello, World!" },
  {
    name: "json",
    method: "GET",
    path: "/json",
    type: "application/json",
    answer: JSON.stringify({
      profile: profile(42),
      items: products.map(({ id, title, priceCents, stock }) => ({ id, title, priceCents, inStock: stock > 0 })),
    }),
  },
  {
    name: "params",
    method: "GET",
    path: "/users/42/posts/hello-world?page=2&limit=10&sort=top",
    type: "application/json",
    answer: JSON.stringify({ userId: 42, postId: "hello-world", page: 2, limit: 10, sort: "top" }),
  },
  {
    name: "async",
    method: "GET",
    path: "/async/42",
    type: "application/json",
    answer: JSON.stringify({ id: 42, name: "User 42", orders: 5, totalCents: [0, 1, 2, 3, 4].reduce((sum, n) => sum + 1000 + n * 250 + 42, 0) }),
  },
  {
    name: "stream",
    method: "GET",
    path: "/stream",
    type: "text/csv",
    answer: products.map(({ id, title, priceCents }) => `${id},${title},${priceCents}\n`).join(""),
  },
  // The order is validated with zod.
  { name: "post", method: "POST", path: "/shops/west/orders", type: "application/json", request: JSON.stringify(order), answer: receipt },
  // The order is validated by hand: a typeof test for every member, and no other key is allowed.
  { name: "hand", method: "POST", path: "/shops/west/checked-orders", type: "application/json", request: JSON.stringify(order), answer: receipt },
  // The order is parsed and cast to its type. Only the ranges of its values are checked.
  { name: "typed", method: "POST", path: "/shops/west/typed-orders", type: "application/json", request: JSON.stringify(order), answer: receipt },
];

export const refusal = JSON.stringify({ error: "invalid order" });

const [first, ...rest] = order.items;

/** The routes that validate must answer each of these with 400. The route that only casts must answer as plain Bun does. */
export const badOrders: Record<string, string> = {
  "a quantity of zero": JSON.stringify({ ...order, items: [{ ...first, quantity: 0 }] }),
  "a name that is a number": JSON.stringify({ ...order, customer: { ...order.customer, name: 5 } }),
  "an unknown key": JSON.stringify({ ...order, note: "leave at the door" }),
  "an unknown key in an item": JSON.stringify({ ...order, items: [{ ...first, color: "red" }, ...rest] }),
  "a quantity that is not an integer": JSON.stringify({ ...order, items: [{ ...first, quantity: 1.5 }, ...rest] }),
  "an email address without @": JSON.stringify({ ...order, customer: { ...order.customer, email: "zoe at example.com" } }),
  "no customer": JSON.stringify({ items: order.items, coupon: order.coupon }),
  "a coupon that is null": JSON.stringify({ ...order, coupon: null }),
  "text that is not JSON": '{"customer":',
};

// For ./measure/measure.py.
if (import.meta.main) console.log(JSON.stringify({ routes, badOrders, refusal }));

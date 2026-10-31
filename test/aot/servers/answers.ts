// The routes that every server under ./app and ./tanstack implements, with the expected response bodies.
// The bodies are computed here, independently of any server.

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

function receiptFor({ customer, items, coupon }: Omit<typeof order, "coupon"> & { coupon?: string }) {
  const lines = items.map(item => ({ sku: item.sku, lineCents: item.quantity * item.unitCents }));
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineCents, 0);
  const discountCents = coupon === "TENOFF" ? Math.floor(subtotalCents / 10) : 0;
  const taxCents = Math.floor(((subtotalCents - discountCents) * 8) / 100);
  return JSON.stringify({
    shop: "west",
    customerId: customer.id,
    lines,
    subtotalCents,
    discountCents,
    taxCents,
    totalCents: subtotalCents - discountCents + taxCents,
  });
}
const receipt = receiptFor(order);

export interface Route {
  name: string;
  method: "GET" | "POST";
  path: string;
  /** "-": any. */
  type: string;
  headers?: Record<string, string>;
  request?: string;
  /** 200 unless given. */
  status?: number;
  expectedBody: string;
}

export const routes: Route[] = [
  { name: "text", method: "GET", path: "/text", type: "text/plain", expectedBody: "Hello, World!" },
  {
    name: "json",
    method: "GET",
    path: "/json",
    type: "application/json",
    expectedBody: JSON.stringify({
      profile: profile(42),
      items: products.map(({ id, title, priceCents, stock }) => ({ id, title, priceCents, inStock: stock > 0 })),
    }),
  },
  {
    name: "params",
    method: "GET",
    path: "/users/42/posts/hello-world?page=2&limit=10&sort=top",
    type: "application/json",
    expectedBody: JSON.stringify({ userId: 42, postId: "hello-world", page: 2, limit: 10, sort: "top" }),
  },
  {
    name: "async",
    method: "GET",
    path: "/async/42",
    type: "application/json",
    expectedBody: JSON.stringify({ id: 42, name: "User 42", orders: 5, totalCents: [0, 1, 2, 3, 4].reduce((sum, n) => sum + 1000 + n * 250 + 42, 0) }),
  },
  {
    name: "stream",
    method: "GET",
    path: "/stream",
    type: "text/csv",
    expectedBody: products.map(({ id, title, priceCents }) => `${id},${title},${priceCents}\n`).join(""),
  },
  // The order is validated with zod.
  { name: "post", method: "POST", path: "/shops/west/orders", type: "application/json", request: JSON.stringify(order), expectedBody: receipt },
  // The order is validated by hand: a typeof check for every property, and unknown keys are rejected.
  { name: "hand", method: "POST", path: "/shops/west/checked-orders", type: "application/json", request: JSON.stringify(order), expectedBody: receipt },
  // The order is parsed and cast to its type without validation. Only value ranges are checked.
  { name: "typed", method: "POST", path: "/shops/west/typed-orders", type: "application/json", request: JSON.stringify(order), expectedBody: receipt },
];

export const invalidOrderBody = JSON.stringify({ error: "invalid order" });

const [first, ...rest] = order.items;

/** The validating routes must respond to each of these with 400. The route that only casts must respond like Bun without --aot. */
export const invalidOrders: Record<string, string> = {
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

/** The routes that take an order once more, with an order whose last item is wrong: everything is checked, and then refused. */
export const refusedRoutes: Route[] = routes.filter(route => route.method === "POST").map(route => ({
  ...route,
  name: route.name + "-refused",
  request: JSON.stringify({ ...order, items: [...order.items.slice(0, -1), { ...order.items.at(-1), quantity: 0 }] }),
  status: 400,
  expectedBody: invalidOrderBody,
}));

function summary(id: number) {
  return { id, name: `User ${id}`, orders: 5, totalCents: [0, 1, 2, 3, 4].reduce((sum, n) => sum + 1000 + n * 250 + id, 0) };
}

export const effectInvalidOrderBody = JSON.stringify({ _tag: "InvalidOrder", error: "invalid order" });

/** The routes of the servers under ./effect: six of the routes above, with the same bodies, and five of their own. */
export const effectRoutes: Route[] = [
  ...routes.filter(route => ["text", "json", "params", "async", "stream", "post"].includes(route.name)),
  { name: "profile", method: "GET", path: "/users/42", type: "application/json", expectedBody: JSON.stringify(profile(42)) },
  {
    name: "list",
    method: "GET",
    path: "/products",
    type: "application/json",
    expectedBody: JSON.stringify(
      products.map(({ id, title, priceCents, stock }) => ({
        id,
        title,
        priceCents,
        stock,
        tags: id % 2 === 0 ? ["even", `shelf-${id % 5}`] : [`shelf-${id % 5}`],
        addedAt: `2026-02-${String(1 + (id % 28)).padStart(2, "0")}T12:00:00.000Z`,
      })),
    ),
  },
  // Fails with a typed error that the API maps to a status.
  { name: "missing", method: "GET", path: "/users/1000", type: "application/json", status: 404, expectedBody: JSON.stringify({ _tag: "UserNotFound", id: 1000 }) },
  // Ten summaries, each three effects in sequence, computed concurrently.
  { name: "concurrent", method: "GET", path: "/summaries?from=20", type: "application/json", expectedBody: JSON.stringify(Array.from({ length: 10 }, (_, n) => summary(20 + n))) },
  { name: "refused", method: "POST", path: "/shops/west/orders", type: "application/json", request: invalidOrders["a quantity of zero"], status: 400, expectedBody: effectInvalidOrderBody },
];

// The routes of ./app/api-bun.ts, ./app/api-thin.ts and ./app/api-hono.ts.
const task = (n: number) => ({
  id: 300 + n,
  title: `Task ${n} of project 3`,
  status: n % 3 === 0 ? "done" : "open",
  priority: 1 + (n % 4),
  assignee: `User ${1 + (n % 20)}`,
  tags: n % 2 === 0 ? ["backend", "urgent"] : ["frontend"],
});
const anonymous = { "x-request-id": "r-1" };
const signedIn = { ...anonymous, authorization: "Bearer token-7" };

export const apiRoutes: Route[] = [
  // Hono clones the Response to add a header after the handler, and the clone of `new Response("ok")` has another Content-Type.
  { name: "health", method: "GET", path: "/health", type: "-", headers: anonymous, expectedBody: "ok" },
  { name: "task", method: "GET", path: "/api/projects/3/tasks/317", type: "application/json", headers: signedIn, expectedBody: JSON.stringify(task(17)) },
  {
    name: "list",
    method: "GET",
    path: "/api/projects/3/tasks?status=open&limit=5",
    type: "application/json",
    headers: signedIn,
    expectedBody: JSON.stringify({ projectId: 3, requestedBy: "User 7", total: 20, tasks: [1, 2, 4, 5, 7].map(task) }),
  },
  {
    name: "create",
    method: "POST",
    path: "/api/projects/3/tasks",
    type: "application/json",
    status: 201,
    headers: signedIn,
    request: JSON.stringify({ title: "Write the report", priority: 2, assigneeId: 5, tags: ["docs", "q4"], note: "before Friday" }),
    expectedBody: JSON.stringify({ id: 399, projectId: 3, title: "Write the report", priority: 2, assignee: "User 5", tagCount: 2, createdBy: "User 7" }),
  },
  { name: "denied", method: "GET", path: "/api/projects/3/tasks/317", type: "application/json", status: 401, headers: anonymous, expectedBody: JSON.stringify({ error: "missing token", requestId: "r-1" }) },
  { name: "missing", method: "GET", path: "/nothing/here", type: "application/json", status: 404, headers: anonymous, expectedBody: JSON.stringify({ error: "not found", requestId: "r-1" }) },
];

// Used by ./measure/measure.py.
if (import.meta.main) console.log(JSON.stringify({ routes, effectRoutes, apiRoutes, refusedRoutes, invalidOrders, invalidOrderBody }));

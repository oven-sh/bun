interface User {
  id: number
  name: string
  email: string
  age: number
  active: boolean
  score: number
  role: "admin" | "member"
  city: string
  createdAt: Date
  visits: number
  passwordHash: string
}

interface Profile {
  id: number
  name: string
  email: string
  age: number
  active: boolean
  score: number
  role: "admin" | "member"
  city: string
  createdAt: string
  visits: number
}

interface Product {
  id: number
  title: string
  priceCents: number
  stock: number
  tags: string[]
  addedAt: Date
}

interface PastOrder {
  id: number
  userId: number
  totalCents: number
}

interface Summary {
  id: number
  name: string
  orders: number
  totalCents: number
}

interface OrderItem {
  sku: string
  quantity: number
  unitCents: number
}

interface Order {
  customer: { id: number; name: string; email: string }
  items: OrderItem[]
  coupon?: string
}

interface Line {
  sku: string
  lineCents: number
}

interface Receipt {
  shop: string
  customerId: number
  lines: Line[]
  subtotalCents: number
  discountCents: number
  taxCents: number
  totalCents: number
}

class UserNotFound extends Error {
  readonly id: number
  constructor(id: number) {
    super(`no user ${id}`)
    this.id = id
  }
}

const cities = ["Lisbon", "Osaka", "Denver", "Nairobi", "Oslo"]
const users = new Map<number, User>()
const products: Product[] = []
let placed = 0

for (let id = 1; id <= 100; id++) {
  users.set(id, {
    id,
    name: `User ${id}`,
    email: `user${id}@example.com`,
    age: 20 + (id % 50),
    active: id % 2 === 0,
    score: id + 0.5,
    role: id % 10 === 0 ? "admin" : "member",
    city: cities[id % cities.length]!,
    createdAt: new Date(`2026-01-${String(1 + (id % 28)).padStart(2, "0")}T00:00:00.000Z`),
    visits: id * 37,
    passwordHash: `hash-${id}`
  })
}
for (let id = 1; id <= 50; id++) {
  products.push({
    id,
    title: `Product ${id}`,
    priceCents: 199 + id * 350,
    stock: id % 7,
    tags: id % 2 === 0 ? ["even", `shelf-${id % 5}`] : [`shelf-${id % 5}`],
    addedAt: new Date(`2026-02-${String(1 + (id % 28)).padStart(2, "0")}T12:00:00.000Z`)
  })
}

function findUser(id: number): User {
  const user = users.get(id)
  if (!user) throw new UserNotFound(id)
  return user
}

function toProfile(user: User): Profile {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    age: user.age,
    active: user.active,
    score: user.score,
    role: user.role,
    city: user.city,
    createdAt: user.createdAt.toISOString(),
    visits: user.visits
  }
}

async function findUserLater(id: number): Promise<User> {
  return findUser(id)
}

async function findOrders(userId: number): Promise<PastOrder[]> {
  const orders: PastOrder[] = []
  for (let n = 0; n < 5; n++) orders.push({ id: userId * 10 + n, userId, totalCents: 1000 + n * 250 + userId })
  return orders
}

async function sumOrders(orders: PastOrder[]): Promise<number> {
  let totalCents = 0
  for (const order of orders) totalCents += order.totalCents
  return totalCents
}

async function summarize(id: number): Promise<Summary> {
  const user = await findUserLater(id)
  const orders = await findOrders(user.id)
  const totalCents = await sumOrders(orders)
  return { id: user.id, name: user.name, orders: orders.length, totalCents }
}

async function findProducts(offset: number, limit: number): Promise<Product[]> {
  return products.slice(offset, offset + limit)
}

async function* exportProducts(): AsyncGenerator<string> {
  for (let offset = 0; offset < products.length; offset += 5) {
    let text = ""
    for (const product of await findProducts(offset, 5)) text += `${product.id},${product.title},${product.priceCents}\n`
    yield text
  }
}

function parsePositive(text: string | null | undefined): number | undefined {
  const value = Number(text)
  return text !== "" && Number.isInteger(value) && value > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOnly(value: Record<string, unknown>, first: string, second: string, third: string): boolean {
  for (const key in value) if (key !== first && key !== second && key !== third) return false
  return true
}

const emailPattern = /^[^@\s]+@[^@\s]+$/

function parseOrder(value: unknown): Order | null {
  if (!isRecord(value) || !hasOnly(value, "customer", "items", "coupon")) return null
  const { customer, items, coupon } = value
  if (!isRecord(customer) || !hasOnly(customer, "id", "name", "email")) return null
  const { id, name, email } = customer
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1) return null
  if (typeof name !== "string" || name.length < 1 || name.length > 100) return null
  if (typeof email !== "string" || !emailPattern.test(email)) return null
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) return null
  if ("coupon" in value && (typeof coupon !== "string" || coupon.length > 16)) return null
  const parsed: OrderItem[] = []
  for (const item of items) {
    if (!isRecord(item) || !hasOnly(item, "sku", "quantity", "unitCents")) return null
    const { sku, quantity, unitCents } = item
    if (typeof sku !== "string" || sku.length < 1 || sku.length > 32) return null
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) return null
    if (typeof unitCents !== "number" || !Number.isInteger(unitCents) || unitCents < 0) return null
    parsed.push({ sku, quantity, unitCents })
  }
  const order: Order = { customer: { id, name, email }, items: parsed }
  if (typeof coupon === "string") order.coupon = coupon
  return order
}

function placeOrder(shop: string, order: Order): Receipt {
  const lines: Line[] = order.items.map((item) => ({ sku: item.sku, lineCents: item.quantity * item.unitCents }))
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineCents, 0)
  const discountCents = order.coupon === "TENOFF" ? Math.floor(subtotalCents / 10) : 0
  const taxCents = Math.floor(((subtotalCents - discountCents) * 8) / 100)
  placed++
  return {
    shop,
    customerId: order.customer.id,
    lines,
    subtotalCents,
    discountCents,
    taxCents,
    totalCents: subtotalCents - discountCents + taxCents
  }
}

const badRequest = () => new Response(null, { status: 400 })
const invalidOrder = () => Response.json({ _tag: "InvalidOrder", error: "invalid order" }, { status: 400 })

function notFound(error: unknown): Response {
  if (error instanceof UserNotFound) return Response.json({ _tag: "UserNotFound", id: error.id }, { status: 404 })
  throw error
}

const encoder = new TextEncoder()

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  routes: {
    "/text": { GET: () => new Response("Hello, World!", { headers: { "Content-Type": "text/plain" } }) },
    "/json": {
      GET: () =>
        Response.json({
          profile: toProfile(findUser(42)),
          items: products.map((product) => ({
            id: product.id,
            title: product.title,
            priceCents: product.priceCents,
            inStock: product.stock > 0
          }))
        })
    },
    "/users/:userId": {
      GET: (request) => {
        const userId = parsePositive(request.params.userId)
        if (userId === undefined) return badRequest()
        try {
          return Response.json(toProfile(findUser(userId)))
        } catch (error) {
          return notFound(error)
        }
      }
    },
    "/users/:userId/posts/:postId": {
      GET: (request) => {
        const query = new URL(request.url).searchParams
        const userId = parsePositive(request.params.userId)
        const page = query.has("page") ? parsePositive(query.get("page")) : 1
        const limit = query.has("limit") ? parsePositive(query.get("limit")) : 20
        const sort = query.get("sort") ?? "new"
        if (userId === undefined || page === undefined || limit === undefined || (sort !== "new" && sort !== "top")) {
          return badRequest()
        }
        return Response.json({ userId, postId: request.params.postId, page, limit: Math.min(limit, 100), sort })
      }
    },
    "/async/:userId": {
      GET: async (request) => {
        const userId = parsePositive(request.params.userId)
        if (userId === undefined) return badRequest()
        try {
          return Response.json(await summarize(userId))
        } catch (error) {
          return notFound(error)
        }
      }
    },
    "/summaries": {
      GET: async (request) => {
        const from = parsePositive(new URL(request.url).searchParams.get("from"))
        if (from === undefined) return badRequest()
        try {
          return Response.json(await Promise.all(Array.from({ length: 10 }, (_, n) => summarize(from + n))))
        } catch (error) {
          return notFound(error)
        }
      }
    },
    "/products": {
      GET: () =>
        Response.json(
          products.map((product) => ({
            id: product.id,
            title: product.title,
            priceCents: product.priceCents,
            stock: product.stock,
            tags: product.tags,
            addedAt: product.addedAt.toISOString()
          }))
        )
    },
    "/stream": {
      GET: () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              for await (const chunk of exportProducts()) controller.enqueue(encoder.encode(chunk))
              controller.close()
            }
          }),
          { headers: { "Content-Type": "text/csv" } }
        )
    },
    "/shops/:shop/orders": {
      POST: async (request) => {
        const shop = request.params.shop
        if (shop.length < 1 || shop.length > 32) return invalidOrder()
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return invalidOrder()
        }
        const order = parseOrder(body)
        return order ? Response.json(placeOrder(shop, order)) : invalidOrder()
      }
    },
    "/orders/count": { GET: () => Response.json({ placed }) }
  },
  fetch() {
    return new Response(null, { status: 404 })
  }
})

console.log("listening", server.port)

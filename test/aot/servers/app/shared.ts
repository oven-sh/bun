import * as z from "zod";

export interface Profile {
  id: number;
  name: string;
  email: string;
  age: number;
  active: boolean;
  score: number;
  role: string;
  city: string;
  createdAt: string;
  visits: number;
}

export interface Item {
  id: number;
  title: string;
  priceCents: number;
  inStock: boolean;
}

export interface Catalog {
  profile: Profile;
  items: Item[];
}

export interface PostPage {
  userId: number;
  postId: string;
  page: number;
  limit: number;
  sort: string;
}

export interface Line {
  sku: string;
  lineCents: number;
}

export interface Receipt {
  shop: string;
  customerId: number;
  lines: Line[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

export interface Summary {
  id: number;
  name: string;
  orders: number;
  totalCents: number;
}

interface UserRow {
  id: number;
  name: string;
  email: string;
  age: number;
  active: boolean;
  score: number;
  role: string;
  city: string;
  createdAt: string;
  visits: number;
  passwordHash: string;
}

interface ProductRow {
  id: number;
  title: string;
  priceCents: number;
  stock: number;
}

interface OrderRow {
  id: number;
  userId: number;
  totalCents: number;
}

const cities = ["Lisbon", "Osaka", "Denver", "Nairobi", "Oslo"];
const users = new Map<number, UserRow>();
const products: ProductRow[] = [];
const ordersByUser = new Map<number, OrderRow[]>();

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
    createdAt: `2026-01-${String(1 + (id % 28)).padStart(2, "0")}T00:00:00.000Z`,
    visits: id * 37,
    passwordHash: `hash-${id}`,
  });
  const orders: OrderRow[] = [];
  for (let n = 0; n < 5; n++) orders.push({ id: id * 10 + n, userId: id, totalCents: 1000 + n * 250 + id });
  ordersByUser.set(id, orders);
}
for (let id = 1; id <= 50; id++) {
  products.push({ id, title: `Product ${id}`, priceCents: 199 + id * 350, stock: id % 7 });
}

export class NotFound extends Error {}

export function catalog(userId: number): Catalog {
  const user = users.get(userId);
  if (!user) throw new NotFound(`no user ${userId}`);
  return {
    profile: {
      id: user.id,
      name: user.name,
      email: user.email,
      age: user.age,
      active: user.active,
      score: user.score,
      role: user.role,
      city: user.city,
      createdAt: user.createdAt,
      visits: user.visits,
    },
    items: products.map((product) => ({
      id: product.id,
      title: product.title,
      priceCents: product.priceCents,
      inStock: product.stock > 0,
    })),
  };
}

function positive(text: string | null | undefined, fallback: number): number {
  const value = Number(text);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function postPage(
  userId: string,
  postId: string,
  page: string | null | undefined,
  limit: string | null | undefined,
  sort: string | null | undefined,
): PostPage {
  return {
    userId: Number(userId),
    postId,
    page: positive(page, 1),
    limit: Math.min(positive(limit, 20), 100),
    sort: sort ?? "new",
  };
}

const Order = z.strictObject({
  customer: z.strictObject({
    id: z.int().min(1),
    name: z.string().min(1).max(100),
    email: z.string().regex(/^[^@\s]+@[^@\s]+$/),
  }),
  items: z
    .array(
      z.strictObject({
        sku: z.string().min(1).max(32),
        quantity: z.int().min(1).max(1000),
        unitCents: z.int().min(0),
      }),
    )
    .min(1)
    .max(100),
  coupon: z.string().max(16).optional(),
});

export const invalidOrder = { error: "invalid order" };

export function placeOrder(shop: string, body: unknown): Receipt | null {
  if (shop.length < 1 || shop.length > 32) return null;
  const parsed = Order.safeParse(body);
  if (!parsed.success) return null;
  const { customer, items, coupon } = parsed.data;
  const lines: Line[] = items.map((item) => ({ sku: item.sku, lineCents: item.quantity * item.unitCents }));
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineCents, 0);
  const discountCents = coupon === "TENOFF" ? Math.floor(subtotalCents / 10) : 0;
  const taxCents = Math.floor(((subtotalCents - discountCents) * 8) / 100);
  return {
    shop,
    customerId: customer.id,
    lines,
    subtotalCents,
    discountCents,
    taxCents,
    totalCents: subtotalCents - discountCents + taxCents,
  };
}

export interface OrderBody {
  customer: { id: number; name: string; email: string };
  items: { sku: string; quantity: number; unitCents: number }[];
  coupon?: string;
}

const emailPattern = /^[^@\s]+@[^@\s]+$/;

function isValidOrder(order: OrderBody): boolean {
  const { customer, items, coupon } = order;
  if (!Number.isInteger(customer.id) || customer.id < 1) return false;
  if (customer.name.length < 1 || customer.name.length > 100 || !emailPattern.test(customer.email)) return false;
  if (items.length < 1 || items.length > 100) return false;
  if (coupon !== undefined && coupon.length > 16) return false;
  for (const item of items) {
    if (item.sku.length < 1 || item.sku.length > 32) return false;
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) return false;
    if (!Number.isInteger(item.unitCents) || item.unitCents < 0) return false;
  }
  return true;
}

export function placeTypedOrder(shop: string, order: OrderBody): Receipt | null {
  if (shop.length < 1 || shop.length > 32 || !isValidOrder(order)) return null;
  const lines: Line[] = order.items.map((item) => ({ sku: item.sku, lineCents: item.quantity * item.unitCents }));
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineCents, 0);
  const discountCents = order.coupon === "TENOFF" ? Math.floor(subtotalCents / 10) : 0;
  const taxCents = Math.floor(((subtotalCents - discountCents) * 8) / 100);
  return {
    shop,
    customerId: order.customer.id,
    lines,
    subtotalCents,
    discountCents,
    taxCents,
    totalCents: subtotalCents - discountCents + taxCents,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, first: string, second: string, third: string): boolean {
  for (const key in value) if (key !== first && key !== second && key !== third) return false;
  return true;
}

export function parseOrder(value: unknown): OrderBody | null {
  if (!isRecord(value) || !hasOnly(value, "customer", "items", "coupon")) return null;
  const { customer, items, coupon } = value;
  if (!isRecord(customer) || !hasOnly(customer, "id", "name", "email")) return null;
  if (typeof customer.id !== "number" || typeof customer.name !== "string" || typeof customer.email !== "string") return null;
  if (!Array.isArray(items) || (coupon !== undefined && typeof coupon !== "string")) return null;
  const parsed: OrderBody["items"] = [];
  for (const item of items) {
    if (!isRecord(item) || !hasOnly(item, "sku", "quantity", "unitCents")) return null;
    if (typeof item.sku !== "string" || typeof item.quantity !== "number" || typeof item.unitCents !== "number") return null;
    parsed.push({ sku: item.sku, quantity: item.quantity, unitCents: item.unitCents });
  }
  return { customer: { id: customer.id, name: customer.name, email: customer.email }, items: parsed, coupon };
}

export function placeCheckedOrder(shop: string, body: unknown): Receipt | null {
  const order = parseOrder(body);
  return order ? placeTypedOrder(shop, order) : null;
}

async function findUser(id: number): Promise<UserRow> {
  const user = users.get(id);
  if (!user) throw new NotFound(`no user ${id}`);
  return user;
}

async function findOrders(userId: number): Promise<OrderRow[]> {
  return ordersByUser.get(userId) ?? [];
}

async function sumOrders(orders: OrderRow[]): Promise<number> {
  let totalCents = 0;
  for (const order of orders) totalCents += order.totalCents;
  return totalCents;
}

export async function summarize(id: number): Promise<Summary> {
  const user = await findUser(id);
  const orders = await findOrders(user.id);
  const totalCents = await sumOrders(orders);
  return { id: user.id, name: user.name, orders: orders.length, totalCents };
}

async function findProducts(offset: number, limit: number): Promise<ProductRow[]> {
  return products.slice(offset, offset + limit);
}

async function* productPages(size: number): AsyncGenerator<ProductRow[]> {
  for (let offset = 0; offset < products.length; offset += size) {
    yield await findProducts(offset, size);
  }
}

export async function* exportProducts(): AsyncGenerator<string> {
  for await (const page of productPages(5)) {
    let text = "";
    for (const product of page) text += `${product.id},${product.title},${product.priceCents}\n`;
    yield text;
  }
}

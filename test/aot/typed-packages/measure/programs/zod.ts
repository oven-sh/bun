import * as z from "zod";
import { run } from "../turns";

const Address = z.object({
  street: z.string().min(1).max(120),
  city: z.string().min(1),
  postalCode: z.string().regex(/^[0-9A-Z -]{3,10}$/),
  country: z.enum(["US", "DE", "FR", "JP", "BR"]),
});

const Payment = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("card"), lastFour: z.string().length(4), expires: z.string().regex(/^\d\d\/\d\d$/) }),
  z.object({ kind: z.literal("transfer"), iban: z.string().min(15).max(34) }),
  z.object({ kind: z.literal("voucher"), code: z.string().startsWith("V-"), cents: z.number().int().positive() }),
]);

const Item = z.object({
  sku: z.string().regex(/^SKU-\d+$/),
  name: z.string().min(1).max(200),
  quantity: z.number().int().min(1).max(99),
  unitCents: z.number().int().nonnegative(),
  tags: z.array(z.string()).max(8).default([]),
  gift: z.object({ message: z.string().max(280), wrap: z.boolean() }).optional(),
});

const Order = z
  .object({
    id: z.uuid(),
    placedAt: z.iso.datetime(),
    customer: z.object({
      id: z.number().int().positive(),
      name: z.string().trim().min(1),
      email: z.email(),
      phone: z.string().nullable(),
      newsletter: z.boolean().default(false),
    }),
    shipping: Address,
    billing: Address.optional(),
    payment: Payment,
    items: z.array(Item).min(1).max(200),
    coupon: z.union([z.string().toUpperCase(), z.null()]),
    metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  })
  .refine(order => order.items.reduce((sum, item) => sum + item.quantity, 0) <= 500, { message: "too many pieces" })
  .transform(order => ({ ...order, totalCents: order.items.reduce((sum, item) => sum + item.quantity * item.unitCents, 0) }));

function makeOrder(items: number, valid: boolean): unknown {
  return {
    id: "3f2b8c1e-6a4d-4e2b-9c1f-0a1b2c3d4e5f",
    placedAt: "2026-03-14T09:26:53Z",
    customer: { id: 4711, name: "  Zoë Müller ", email: valid ? "zoe@example.com" : "zoe at example", phone: null },
    shipping: { street: "12 Harbor Road", city: "Portland", postalCode: "97201", country: "US" },
    payment: { kind: "card", lastFour: "4242", expires: "08/29" },
    items: Array.from({ length: items }, (_, index) => ({
      sku: `SKU-${1000 + 37 * index}`,
      name: `Item number ${index}`,
      quantity: valid || index % 5 ? 1 + ((2 * index) % 5) : 0,
      unitCents: 199 + 350 * index,
      ...(index % 3 === 0 ? { tags: ["new", "sale"] } : {}),
      ...(index % 7 === 0 ? { gift: { message: "Enjoy!", wrap: true } } : {}),
    })),
    coupon: "tenoff",
    metadata: { source: "web", attempt: 1, express: false },
  };
}

const valid = process.argv[2] !== "invalid";
const text = JSON.stringify(makeOrder(25, valid));

await run(() => {
  const result = Order.safeParse(JSON.parse(text));
  return JSON.stringify(result.success ? result.data : result.error.issues);
});

// The order of ./shared.ts as a type. `bun compile` generates the checks from it, so zod is not in a program that imports this file.
import { JSON } from "bun"; import type { Schema } from "bun";
import { validate } from "bun:bundle";
import type { Line, Receipt } from "./shared";

type SafeInteger = number & Schema.Int & Schema.Max<9007199254740991>;

export type Order = {
  customer: {
    id: SafeInteger & Schema.Min<1>;
    name: string & Schema.MinLength<1> & Schema.MaxLength<100>;
    email: string & Schema.Pattern<"^[^@\\s]+@[^@\\s]+$">;
  };
  items: {
    sku: string & Schema.MinLength<1> & Schema.MaxLength<32>;
    quantity: number & Schema.Int & Schema.Min<1> & Schema.Max<1000>;
    unitCents: SafeInteger & Schema.Min<0>;
  }[] &
    Schema.MinItems<1> &
    Schema.MaxItems<100>;
  coupon?: string & Schema.MaxLength<16>;
} & Schema.DeepStrict;

export const invalidOrder = { error: "invalid order" };

function priceOrder(shop: string, { customer, items, coupon }: Order): Receipt {
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

export function placeValidatedOrder(shop: string, body: unknown): Receipt | null {
  if (shop.length < 1 || shop.length > 32) return null;
  try {
    return priceOrder(shop, validate<Order>(body));
  } catch {
    return null;
  }
}

export function placeParsedOrder(shop: string, text: string): Receipt | null {
  if (shop.length < 1 || shop.length > 32) return null;
  try {
    return priceOrder(shop, JSON.parse<Order>(text));
  } catch {
    return null;
  }
}

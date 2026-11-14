import { Schema } from "effect"
import { UserId } from "./User.ts"

export const Shop = Schema.String.check(Schema.isBetweenLength(1, 32))

export class Customer extends Schema.Class<Customer>("Customer")({
  id: UserId,
  name: Schema.String.check(Schema.isBetweenLength(1, 100)),
  email: Schema.String.check(Schema.isPattern(/^[^@\s]+@[^@\s]+$/))
}) {}

export class OrderItem extends Schema.Class<OrderItem>("OrderItem")({
  sku: Schema.String.check(Schema.isBetweenLength(1, 32)),
  quantity: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
  unitCents: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
}) {}

export class Order extends Schema.Class<Order>("Order")({
  customer: Customer,
  items: Schema.Array(OrderItem).check(Schema.isBetweenLength(1, 100)),
  coupon: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(16)))
}) {}

export class Line extends Schema.Class<Line>("Line")({
  sku: Schema.String,
  lineCents: Schema.Int
}) {}

export class Receipt extends Schema.Class<Receipt>("Receipt")({
  shop: Shop,
  customerId: UserId,
  lines: Schema.Array(Line),
  subtotalCents: Schema.Int,
  discountCents: Schema.Int,
  taxCents: Schema.Int,
  totalCents: Schema.Int
}) {}

export class InvalidOrder extends Schema.TaggedError<InvalidOrder>()(
  "InvalidOrder",
  { error: Schema.String },
  { httpApiStatus: 400 }
) {}

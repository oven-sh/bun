import { Schema } from "effect"

export const ProductId = Schema.Int.check(Schema.isGreaterThan(0)).pipe(Schema.brand("ProductId"))
export type ProductId = typeof ProductId.Type

export class Product extends Schema.Class<Product>("Product")({
  id: ProductId,
  title: Schema.String,
  priceCents: Schema.Int,
  stock: Schema.Int,
  tags: Schema.Array(Schema.String),
  addedAt: Schema.DateTimeUtc
}) {}

export class Item extends Schema.Class<Item>("Item")({
  id: ProductId,
  title: Schema.String,
  priceCents: Schema.Int,
  inStock: Schema.Boolean
}) {}

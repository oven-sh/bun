import { Context, DateTime, Effect, Layer } from "effect"
import { Product, ProductId } from "../domain/Product.ts"

export class Products extends Context.Service<Products, {
  readonly all: Effect.Effect<ReadonlyArray<Product>>
  page(offset: number, limit: number): Effect.Effect<ReadonlyArray<Product>>
}>()("aot/Products") {
  static readonly layer = Layer.effect(
    Products,
    Effect.gen(function*() {
      const products: Array<Product> = []
      for (let n = 1; n <= 50; n++) {
        products.push(
          new Product({
            id: ProductId.make(n),
            title: `Product ${n}`,
            priceCents: 199 + n * 350,
            stock: n % 7,
            tags: n % 2 === 0 ? ["even", `shelf-${n % 5}`] : [`shelf-${n % 5}`],
            addedAt: DateTime.makeUnsafe(`2026-02-${String(1 + (n % 28)).padStart(2, "0")}T12:00:00.000Z`)
          })
        )
      }

      const page = Effect.fn("Products.page")(function*(offset: number, limit: number) {
        return products.slice(offset, offset + limit)
      })

      return Products.of({ all: Effect.succeed(products), page })
    })
  )
}

import { Context, Effect, Layer, Ref } from "effect"
import { Line, type Order, Receipt } from "../domain/Order.ts"
import type { UserId } from "../domain/User.ts"

export interface PastOrder {
  readonly id: number
  readonly userId: UserId
  readonly totalCents: number
}

export class Orders extends Context.Service<Orders, {
  readonly placed: Effect.Effect<number>
  findByUser(userId: UserId): Effect.Effect<ReadonlyArray<PastOrder>>
  total(orders: ReadonlyArray<PastOrder>): Effect.Effect<number>
  place(shop: string, order: Order): Effect.Effect<Receipt>
}>()("aot/Orders") {
  static readonly layer = Layer.effect(
    Orders,
    Effect.gen(function*() {
      const placed = yield* Ref.make(0)

      const findByUser = Effect.fn("Orders.findByUser")(function*(userId: UserId) {
        const orders: Array<PastOrder> = []
        for (let n = 0; n < 5; n++) {
          orders.push({ id: userId * 10 + n, userId, totalCents: 1000 + n * 250 + userId })
        }
        return orders
      })

      const total = Effect.fn("Orders.total")(function*(orders: ReadonlyArray<PastOrder>) {
        let totalCents = 0
        for (const order of orders) totalCents += order.totalCents
        return totalCents
      })

      const place = Effect.fn("Orders.place")(function*(shop: string, order: Order) {
        const lines = order.items.map((item) => new Line({ sku: item.sku, lineCents: item.quantity * item.unitCents }))
        const subtotalCents = lines.reduce((sum, line) => sum + line.lineCents, 0)
        const discountCents = order.coupon === "TENOFF" ? Math.floor(subtotalCents / 10) : 0
        const taxCents = Math.floor(((subtotalCents - discountCents) * 8) / 100)
        yield* Ref.update(placed, (count) => count + 1)
        return new Receipt({
          shop,
          customerId: order.customer.id,
          lines,
          subtotalCents,
          discountCents,
          taxCents,
          totalCents: subtotalCents - discountCents + taxCents
        })
      })

      return Orders.of({ placed: Ref.get(placed), findByUser, total, place })
    })
  )
}

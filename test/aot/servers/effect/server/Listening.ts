import { Effect, Layer } from "effect"
import { HttpServer } from "effect/http"

export const Listening = Layer.effectDiscard(
  Effect.gen(function*() {
    const server = yield* HttpServer.HttpServer
    if (server.address._tag !== "UnixPathAddress") {
      console.log("listening", server.address.port)
    }
  })
)

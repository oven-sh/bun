import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Layer } from "effect"
import { HttpRouter } from "effect/http"
import { ApiRoutes } from "./server/Http.ts"
import { Listening } from "./server/Listening.ts"

const HttpServerLayer = HttpRouter.serve(ApiRoutes, { disableLogger: true }).pipe(
  Layer.merge(Listening),
  Layer.provide(BunHttpServer.layer({ hostname: "127.0.0.1", port: Number(process.env.PORT ?? 3000) }))
)

Layer.launch(HttpServerLayer).pipe(BunRuntime.runMain)

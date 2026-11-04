import { bodyParser } from "@koa/bodyparser";
import Router from "@koa/router";
import Koa from "koa";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import {
  catalog,
  exportProducts,
  invalidOrder,
  placeCheckedOrder,
  placeOrder,
  placeTypedOrder,
  postPage,
  summarize,
  type OrderBody,
} from "./shared";

const app = new Koa();
const router = new Router();

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

router.get("/text", ctx => {
  ctx.body = "Hello, World!";
});

router.get("/json", ctx => {
  ctx.body = catalog(42);
});

router.get("/users/:userId/posts/:postId", ctx => {
  const { page, limit, sort } = ctx.query;
  ctx.body = postPage(ctx.params.userId, ctx.params.postId, text(page), text(limit), text(sort));
});

router.post("/shops/:shop/orders", bodyParser(), ctx => {
  const receipt = placeOrder(ctx.params.shop, ctx.request.body);
  if (receipt) {
    ctx.body = receipt;
  } else {
    ctx.status = 400;
    ctx.body = invalidOrder;
  }
});

router.post("/shops/:shop/typed-orders", bodyParser(), ctx => {
  try {
    const receipt = placeTypedOrder(ctx.params.shop, ctx.request.body as OrderBody);
    if (receipt) {
      ctx.body = receipt;
      return;
    }
  } catch {}
  ctx.status = 400;
  ctx.body = invalidOrder;
});

router.post("/shops/:shop/checked-orders", bodyParser(), ctx => {
  const receipt = placeCheckedOrder(ctx.params.shop, ctx.request.body);
  if (receipt) {
    ctx.body = receipt;
  } else {
    ctx.status = 400;
    ctx.body = invalidOrder;
  }
});

router.get("/async/:id", async ctx => {
  ctx.body = await summarize(Number(ctx.params.id));
});

router.get("/stream", ctx => {
  ctx.type = "text/csv";
  ctx.body = Readable.from(exportProducts());
});

app.use(router.routes()).use(router.allowedMethods());

const server = app.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () => {
  console.log("listening", (server.address() as AddressInfo).port);
});

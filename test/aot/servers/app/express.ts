import express from "express";
import type { AddressInfo } from "node:net";
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

const app = express();

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

app.get("/text", (req, res) => {
  res.type("text/plain").send("Hello, World!");
});

app.get("/json", (req, res) => {
  res.json(catalog(42));
});

app.get("/users/:userId/posts/:postId", (req, res) => {
  const { page, limit, sort } = req.query;
  res.json(postPage(req.params.userId, req.params.postId, text(page), text(limit), text(sort)));
});

app.post("/shops/:shop/orders", express.json(), (req, res) => {
  const receipt = placeOrder(req.params.shop, req.body);
  if (receipt) res.json(receipt);
  else res.status(400).json(invalidOrder);
});

app.post("/shops/:shop/typed-orders", express.json(), (req, res) => {
  try {
    const receipt = placeTypedOrder(req.params.shop, req.body as OrderBody);
    if (receipt) res.json(receipt);
    else res.status(400).json(invalidOrder);
  } catch {
    res.status(400).json(invalidOrder);
  }
});

app.post("/shops/:shop/checked-orders", express.json(), (req, res) => {
  const receipt = placeCheckedOrder(req.params.shop, req.body);
  if (receipt) res.json(receipt);
  else res.status(400).json(invalidOrder);
});

app.get("/async/:id", async (req, res) => {
  res.json(await summarize(Number(req.params.id)));
});

app.get("/stream", async (req, res) => {
  res.type("text/csv");
  for await (const chunk of exportProducts()) res.write(chunk);
  res.end();
});

const server = app.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () => {
  console.log("listening", (server.address() as AddressInfo).port);
});

import express from "express";
import type { AddressInfo } from "node:net";
import { invalidOrder, placeParsedOrder, placeValidatedOrder } from "./validated";

const app = express();

app.post("/shops/:shop/validated-orders", express.json(), (req, res) => {
  const receipt = placeValidatedOrder(req.params.shop, req.body);
  if (receipt) res.json(receipt);
  else res.status(400).json(invalidOrder);
});

app.post("/shops/:shop/parsed-orders", express.text({ type: "application/json" }), (req, res) => {
  const receipt = typeof req.body === "string" ? placeParsedOrder(req.params.shop, req.body) : null;
  if (receipt) res.json(receipt);
  else res.status(400).json(invalidOrder);
});

const server = app.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () => {
  console.log("listening", (server.address() as AddressInfo).port);
});

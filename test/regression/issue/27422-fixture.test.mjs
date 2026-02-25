import { it } from "node:test";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

it("async test exceeding default bun timeout", async () => {
  await sleep(7000);
});

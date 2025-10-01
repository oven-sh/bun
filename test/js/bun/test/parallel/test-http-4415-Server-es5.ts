import { createTest } from "node-harness";
import { once } from "node:events";
import { Server } from "node:http";
const { expect } = createTest(import.meta.path);

await using server = Server((req, res) => {
  res.end();
});
server.listen(0);
await once(server, "listening");
const res = await fetch(`http://localhost:${server.address().port}`);
expect(res.status).toBe(200);

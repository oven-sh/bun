import { createTest } from "node-harness";
import { Server } from "node:http";
const { expect } = createTest(import.meta.path);

await using server = Server((req, res) => {
  res.end();
});
server.listen(0);
const res = await fetch(`http://localhost:${server.address().port}`);
expect(res.status).toBe(200);

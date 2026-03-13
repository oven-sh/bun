import { createTest } from "node-harness";
import { ServerResponse } from "node:http";
const { expect } = createTest(import.meta.path);

function Response(req) {
  ServerResponse.call(this, req);
}
Response.prototype = Object.create(ServerResponse.prototype);
const req = {};
const res = new Response(req);
expect(res.req).toBe(req);

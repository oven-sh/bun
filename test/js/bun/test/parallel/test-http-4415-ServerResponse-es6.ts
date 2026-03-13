import { createTest } from "node-harness";
import { ServerResponse } from "node:http";
const { expect } = createTest(import.meta.path);

class Response extends ServerResponse {
  constructor(req) {
    super(req);
  }
}
const req = {};
const res = new Response(req);
expect(res.req).toBe(req);

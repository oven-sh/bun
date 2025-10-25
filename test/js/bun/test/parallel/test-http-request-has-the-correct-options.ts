import { createTest } from "node-harness";
import http from "node:http";
const { expect } = createTest(import.meta.path);

const { promise, resolve } = Promise.withResolvers();
const req = http.request("http://google.com/", resolve);
req.end();
const response = await promise;
expect(response.req.agent.defaultPort).toBe(80);
expect(response.req.protocol).toBe("http:");
req.destroy();

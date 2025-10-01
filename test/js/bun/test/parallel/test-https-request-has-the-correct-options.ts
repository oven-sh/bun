import { createTest } from "node-harness";
import https from "node:https";
const { expect } = createTest(import.meta.path);

const { promise, resolve } = Promise.withResolvers();
https.request("https://google.com/", resolve).end();
const response = await promise;
expect(response.req.port).toBe(443);
expect(response.req.protocol).toBe("https:");

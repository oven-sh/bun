import { createTest } from "node-harness";
import http from "node:http";
const { expect } = createTest(import.meta.path);

const agent = new http.Agent();
const { promise, resolve } = Promise.withResolvers();
http.get({ agent, hostname: "google.com" }, resolve);
const response = await promise;
expect(response.req.agent.defaultPort).toBe(80);
expect(response.req.protocol).toBe("http:");

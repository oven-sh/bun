import { createTest } from "node-harness";
import http from "node:http";
const { expect } = createTest(import.meta.path);

const agent = new http.Agent();
expect(agent.defaultPort).toBe(80);
expect(agent.protocol).toBe("http:");

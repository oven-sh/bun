import { createTest } from "node-harness";
import http from "node:http";
const { expect } = createTest(import.meta.path);

const agent = new http.Agent();
expect((agent as any).defaultPort).toBe(80);
expect((agent as any).protocol).toBe("http:");

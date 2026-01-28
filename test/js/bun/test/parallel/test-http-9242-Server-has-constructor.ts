import { createTest } from "node-harness";
import { Server } from "node:http";
const { expect } = createTest(import.meta.path);

const s = new Server();
expect(s.constructor).toBe(Server);

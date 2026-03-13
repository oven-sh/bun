import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

const server = http.createServer();
await once(server.listen(0), "listening");
expect(server.listening).toBe(true);
server.closeAllConnections();
expect(server.listening).toBe(false);

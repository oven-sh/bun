import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

const server = http.createServer();
await once(server.listen(0), "listening");
expect(server.listening).toBe(true);
// Like Node.js, closeAllConnections() only destroys connections. The listener stays open.
server.closeAllConnections();
expect(server.listening).toBe(true);
server.close();
expect(server.listening).toBe(false);

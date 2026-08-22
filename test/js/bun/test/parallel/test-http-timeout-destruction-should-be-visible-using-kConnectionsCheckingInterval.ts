import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

const { kConnectionsCheckingInterval } = require("_http_server");
const server = http.createServer();
await once(server.listen(0), "listening");
expect(server[kConnectionsCheckingInterval]._destroyed).toBe(false);
// Only close() tears the interval down; closeAllConnections() keeps listening.
server.closeAllConnections();
expect(server[kConnectionsCheckingInterval]._destroyed).toBe(false);
server.close();
expect(server[kConnectionsCheckingInterval]._destroyed).toBe(true);
await once(server, "close");

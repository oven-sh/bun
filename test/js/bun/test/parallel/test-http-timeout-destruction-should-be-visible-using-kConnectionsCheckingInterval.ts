import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

const { kConnectionsCheckingInterval } = require("_http_server");
const server = http.createServer();
await once(server.listen(0), "listening");
server.closeAllConnections();
expect(server[kConnectionsCheckingInterval]._destroyed).toBe(true);

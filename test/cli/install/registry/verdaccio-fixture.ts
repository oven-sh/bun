// Entry point of the verdaccio process that VerdaccioRegistry (test/harness.ts) forks.
//
// verdaccio's own CLI binds whatever port it is told to and only reports that it
// started, so the port would have to be guessed up front. Its programmatic API hands
// back the server before it listens; listen on port 0 and report what the kernel gave.
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { runServer } from "verdaccio";

const configPath = process.argv[2];
if (!configPath) {
  // Without a path verdaccio would go looking for (and create) a config under $HOME.
  throw new Error("usage: verdaccio-fixture.ts <verdaccio.yaml>");
}

const server: Server = await runServer(configPath);
// Bind the IPv4 loopback explicitly: `localhost` is `::1` first on some hosts, while
// the install client connects to 127.0.0.1 and would have every request refused.
server.listen(0, "127.0.0.1", () => {
  process.send!({ verdaccio_port: (server.address() as AddressInfo).port });
});

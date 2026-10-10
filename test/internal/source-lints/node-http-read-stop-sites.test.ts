import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// A node:http connection that does not read and has nothing left to send does not hold the event
// loop, like a libuv handle after uv_read_stop(). The server learns that state from one function,
// refreshAtRestOf in JSNodeHTTPServerSocket.cpp, so every native stop and restart of the reads of
// such a socket has to reach it:
//   - a stop that does not leaves a process that never exits after server.close(),
//   - a restart that does not lets the process exit while the connection reads.
// These are the functions that stop or restart the reads today, each with the call in it that
// tells the state. A new site belongs in this list with its own.
const sites: Record<string, Record<string, string | null>> = {
  "src/runtime/server/NodeHTTPResponse.rs": {
    "pause_socket: pause": "Bun__NodeHTTP__onReadsStopped(",
    "pause_socket_reads: pause": "Bun__NodeHTTP__onReadsPaused(",
  },
  "src/jsc/bindings/node/JSNodeHTTPServerSocket.cpp": {
    // A tunnel tells its state where it changes: at the end of its stream, at a write, at a drain.
    "applyTunnelReads: pause": null,
    "applyTunnelReads: resume": null,
    // A WebSocket has the socket from here on. The server does not count it as a connection.
    "releaseTunnelReadsForUpgrade: resume": null,
    "halfClose: pause": "endReadsStop<",
    "halfClose: resume": "endReadsStop<",
    "resumeReads: resume": "endReadsStop<",
  },
};

const call = /\bus_socket_(pause|resume)\(|(?:->|\.)(pause|resume)\(\)/;
const rustFunction = /^\s*(?:pub(?:\([a-z]+\))?\s+)?(?:unsafe\s+)?(?:extern\s+"C"\s+)?fn\s+(\w+)/;
// A definition starts in column 0 and has no semicolon: `void JSNodeHTTPServerSocket::halfClose(...)`.
const cppFunction = /^[A-Za-z_][^;(]*?(\w+)\([^;]*$/;

test.each(Object.keys(sites))("%s tells the at-rest state where it stops or restarts the reads", file => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const source = readFileSync(path.join(repoRoot, file), "utf8");
  // Comments name these calls too.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, "")).replace(/\/\/.*$/gm, "");
  const definition = file.endsWith(".rs") ? rustFunction : cppFunction;
  const found: string[] = [];
  const bodies: Record<string, string> = {};
  let enclosing = "";
  for (const line of code.split("\n")) {
    enclosing = definition.exec(line)?.[1] ?? enclosing;
    bodies[enclosing] = (bodies[enclosing] ?? "") + line + "\n";
    const match = call.exec(line);
    if (match) found.push(`${enclosing}: ${match[1] ?? match[2]}`);
  }
  expect(found).toEqual(Object.keys(sites[file]));
  for (const [site, tells] of Object.entries(sites[file])) {
    if (tells) expect(bodies[site.split(":")[0]]).toContain(tells);
  }
});

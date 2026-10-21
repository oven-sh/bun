// Sends one TXT query to the DNS server at argv[2] and then blocks the event
// loop until a byte arrives on stdin. The test sets RES_OPTIONS=use-vc, so
// c-ares opens its TCP connection inside resolveTxt(). With TCP Fast Open it
// also writes the query there, and the answer can be in the socket before this
// process polls it for the first time.
import { Resolver } from "node:dns";
import { readSync } from "node:fs";

// 5000 is the longest timeout c-ares accepts for a first query. The query must
// not time out while the event loop is blocked.
const resolver = new Resolver({ timeout: 5000, tries: 1 });
resolver.setServers([process.argv[2]]);

let calls = 0;
resolver.resolveTxt("example.test", (err, records) => {
  calls++;
  // Print one turn of the event loop later, so that a second call is counted.
  setImmediate(() => {
    console.log(JSON.stringify({ calls, code: err ? (err as NodeJS.ErrnoException).code : null, records }));
    process.exit(0);
  });
});

readSync(0, Buffer.alloc(1));

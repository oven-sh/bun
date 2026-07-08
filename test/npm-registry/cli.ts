/**
 * Runs the registry standalone, for poking at it with `curl` or
 * pointing a local `bunfig.toml` at it while debugging a test.
 *
 *   bun test/npm-registry/cli.ts
 *   bun test/npm-registry/cli.ts --port 4873 --fixtures test/cli/install/registry/packages
 *   bun test/npm-registry/cli.ts --verbose
 */

import { parseArgs } from "node:util";
import { NpmRegistry } from "./index";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "0" },
    // Loopback-only for a manually-launched debug server, spelled as
    // the address and not as "localhost": binding the name picks one
    // of 127.0.0.1/::1 and a client resolving it to the other cannot
    // connect (see the `hostname` docs in src/registry.ts).
    hostname: { type: "string", default: "127.0.0.1" },
    fixtures: { type: "string", multiple: true },
    verbose: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(
    [
      "usage: bun test/npm-registry/cli.ts [options]",
      "",
      "  --port <n>          listen on a fixed port (default: an OS-assigned one)",
      "  --hostname <host>   default: 127.0.0.1 (loopback only)",
      "  --fixtures <dir>    a fixture tree to serve; may be repeated",
      "  --verbose           log every request",
    ].join("\n"),
  );
  process.exit(0);
}

const registry = await new NpmRegistry({
  port: Number(values.port),
  hostname: values.hostname,
  fixtures: values.fixtures,
  verbose: values.verbose,
}).start();

console.log(`npm registry listening at ${registry.url}`);
if (values.fixtures?.length) {
  console.log(`serving ${registry.names.length} fixture packages from:`);
  for (const dir of values.fixtures) console.log(`  ${dir}`);
}
console.log(`
try:
  curl ${registry.url}-/ping
  curl -H 'accept: application/vnd.npm.install-v1+json' ${registry.url}<package>
`);

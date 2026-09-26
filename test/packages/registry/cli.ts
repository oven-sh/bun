#!/usr/bin/env bun
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Registry } from "./registry.ts";

const usage = `Usage: bun cli.ts [options]

  --storage <dir>          packages to serve: <name>/package.json and the tarballs
  --port <n>               default 4873, 0 takes a free port
  --hostname <address>     default 127.0.0.1
  --public-url <url>       base of the tarball URLs, default: the origin of each request
  --user <name:password>   create a user and print a token for it, repeatable
  --restricted <pattern>   packages that only a logged in user can read, repeatable (@scope/*)
  --verbose                print each request
`;

const { values } = parseArgs({
  options: {
    storage: { type: "string" },
    port: { type: "string", default: "4873" },
    hostname: { type: "string" },
    "public-url": { type: "string" },
    user: { type: "string", multiple: true, default: [] },
    restricted: { type: "string", multiple: true, default: [] },
    verbose: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(usage);
  process.exit(0);
}

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`--port must be a number from 0 to 65535, got "${values.port}"\n\n${usage}`);
  process.exit(1);
}

const registry = new Registry({
  storage: values.storage === undefined ? undefined : resolve(values.storage),
  port,
  hostname: values.hostname,
  publicUrl: values["public-url"],
  access: Object.fromEntries(values.restricted.map(pattern => [pattern, { read: "authenticated" as const }])),
  intercept: values.verbose ? request => console.log(`${request.method} ${new URL(request.url).pathname}`) : undefined,
});

for (const entry of values.user) {
  const colon = entry.indexOf(":");
  if (colon <= 0) {
    console.error(`--user must be name:password, got "${entry}"`);
    process.exit(1);
  }
  const user = registry.auth.addUser(entry.slice(0, colon), entry.slice(colon + 1));
  console.log(`token for ${user.name}: ${registry.auth.createToken(user).token}`);
}

registry.start();
console.log(`registry: ${registry.url}`);

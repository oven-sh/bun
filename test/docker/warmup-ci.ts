#!/usr/bin/env bun
/**
 * Background-start the docker-compose services a given test shard needs.
 *
 * Called from scripts/runner.node.mjs before tests run, with the shard's test
 * paths on argv. Looks up which services each path uses, dedupes, and runs one
 * `docker compose up -d <services>` (no --wait) so containers initialize while
 * the runner is still downloading the bun binary and installing vendor deps.
 * Each test's own ensure() then finds its container already healthy.
 *
 * The path→service map below is hand-maintained. Prefix match — every test
 * under a key gets that key's services. Missing entries just mean that test's
 * container starts at ensure() time instead of here (correct, just slower).
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";

const composeFile = join(import.meta.dirname, "docker-compose.yml");

const map: Record<string, readonly string[]> = {
  "test/js/sql/sql-mysql": ["mysql_plain", "mysql_native_password", "mysql_tls"],
  "test/js/sql/tls-sql": ["postgres_tls"],
  "test/js/sql/local-sql": ["postgres_tls"],
  "test/js/sql/sql.test": ["postgres_plain"],
  "test/js/sql/sql-prepare-false": ["postgres_plain"],
  "test/js/valkey/": ["redis_unified"],
  "test/js/bun/s3/": ["minio"],
  "test/js/web/websocket/autobahn": ["autobahn"],
  "test/js/web/websocket/websocket-proxy": ["squid"],
  "test/integration/mysql2/": ["mysql_plain", "mysql_native_password"],
  "test/regression/issue/21311": ["postgres_plain"],
  "test/regression/issue/24850": ["mysql_plain"],
  "test/regression/issue/26030": ["mysql_plain"],
  "test/regression/issue/26063": ["mysql_plain"],
  "test/regression/issue/28632": ["mysql_plain"],
};

const needed = new Set<string>();
for (const arg of process.argv.slice(2)) {
  const p = arg.replaceAll("\\", "/");
  for (const [prefix, services] of Object.entries(map)) {
    if (p.startsWith(prefix) || p.includes("/" + prefix)) {
      for (const s of services) needed.add(s);
    }
  }
}

if (needed.size === 0) {
  console.log("warmup-ci: no docker services needed for this shard");
  process.exit(0);
}

const services = [...needed];
console.log(`warmup-ci: starting ${services.join(", ")}`);

// --no-recreate: reuse a container another concurrent shard already started.
// up --build is intentionally NOT used — built images are baked at image time
// via prepare-ci.ts, and a missing one will be built on-demand by ensure().
const r = spawnSync(
  "docker",
  ["compose", "-p", "bun-test-services", "-f", composeFile, "up", "-d", "--no-recreate", "--quiet-pull", ...services],
  { stdio: "inherit" },
);
process.exit(r.status ?? 1);

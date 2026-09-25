import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prestartMap } from "../docker/prestart-map.mjs";

// ensure() in test/docker/index.ts is `compose up --wait`, and tests connect as
// soon as it returns. `--wait` only waits for a service's healthcheck; with none
// it returns at "running", before the server has bound its port, and a
// process-existence check (squid used `pgrep squid`; its image runs `squid -Nz`
// before the real server) passes just as early. Either way the first connection
// through the published port is accepted by docker-proxy and closed at once.

interface Service {
  ports?: unknown[];
  healthcheck?: { test?: string | string[] };
}

const dockerDir = join(import.meta.dir, "..", "docker");
const compose = Bun.YAML.parse(readFileSync(join(dockerDir, "docker-compose.yml"), "utf8")) as {
  services: Record<string, Service>;
};
const services = Object.entries(compose.services);

function healthcheckCommand({ healthcheck }: Service): string {
  const command = healthcheck?.test;
  return Array.isArray(command) ? command.join(" ") : (command ?? "");
}

test("docker-compose.yml parses and defines the test services", () => {
  expect(services.length).toBeGreaterThan(5);
});

test("every service with published ports declares a healthcheck", () => {
  const missing = services
    .filter(([, service]) => service.ports?.length && healthcheckCommand(service).trim() === "")
    .map(([name]) => name);
  expect(missing).toEqual([]);
});

test("healthchecks connect to the service instead of checking for a process", () => {
  const processChecks = services
    .filter(([, service]) => /\b(pgrep|pidof|kill -0)\b/.test(healthcheckCommand(service)))
    .map(([name]) => name);
  expect(processChecks).toEqual([]);
});

test("prestart-map.mjs only names services that docker-compose.yml defines", () => {
  const unknown = Object.entries(prestartMap).flatMap(([prefix, names]) =>
    names.filter(name => !(name in compose.services)).map(name => `${prefix}: ${name}`),
  );
  expect(unknown).toEqual([]);
});

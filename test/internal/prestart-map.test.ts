import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import compose from "../docker/docker-compose.yml";
import { prestartMap } from "../docker/prestart-map.mjs";

const testDir = join(import.meta.dir, "..");
const map = Object.entries(prestartMap as Record<string, string[]>);
const testFiles = [
  ...new Glob("{js,regression,integration,cli,bundler,napi}/**/*.test.{ts,tsx,js,mjs}").scanSync(testDir),
]
  .filter(file => !file.includes("node_modules"))
  .map(file => file.replaceAll("\\", "/"));

// Name in a test file -> docker-compose service. describeWithContainer() maps the two legacy names (test/harness.ts).
const services: Record<string, string> = { "mysql:8": "mysql_plain", "mysql:9": "mysql_native_password" };
for (const service of Object.keys(compose.services)) services[service] = service;

function servicesUsedBy(source: Buffer): string[] {
  if (!source.includes("describeWithContainer(") && !source.includes("docker/index")) return [];
  const used = Object.keys(services)
    .filter(name => source.includes(`"${name}"`))
    .map(name => services[name]);
  return used.length ? used : ['no service name found: write it as a plain "string"'];
}

test("every test file that asks for a docker service gets it from the map", () => {
  const missing: Record<string, string[]> = {};
  for (const file of testFiles) {
    const used = servicesUsedBy(readFileSync(join(testDir, file)));
    if (!used.length) continue;
    const mapped = map.filter(([prefix]) => file.startsWith(prefix)).flatMap(([, services]) => services);
    const lacks = used.filter(service => !mapped.includes(service));
    if (lacks.length) missing[file] = lacks;
  }
  expect(missing).toEqual({});
}, 30_000);

test("every prefix in the map matches a test file", () => {
  expect(map.map(([prefix]) => prefix).filter(prefix => !testFiles.some(file => file.startsWith(prefix)))).toEqual([]);
});

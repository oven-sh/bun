// The Docker image of a test service comes from `docker compose build` only.
// A bake of a CI machine image runs that and nothing else
// (test/docker/prepare-ci.ts), and a test starts a service with `--pull never`
// (test/docker/index.ts). So a service that `compose build` leaves out is on
// no CI machine.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("`docker compose build` makes the image of every service in docker-compose.yml", () => {
  const compose = Bun.YAML.parse(readFileSync(join(import.meta.dir, "../../docker/docker-compose.yml"), "utf8")) as {
    include?: unknown;
    services: Record<string, { build?: unknown; profiles?: unknown }>;
  };
  const services = Object.entries(compose.services);
  // `compose build` skips a service with no `build:` section and a service
  // behind a profile, and this lint does not read a file that `include:` names.
  expect({
    include: compose.include,
    noBuildSection: services.filter(([, service]) => service.build === undefined).map(([name]) => name),
    behindProfile: services.filter(([, service]) => service.profiles !== undefined).map(([name]) => name),
  }).toEqual({ include: undefined, noBuildSection: [], behindProfile: [] });
});

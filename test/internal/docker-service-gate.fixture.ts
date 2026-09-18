// Spawned by docker-service-gate.test.ts with a PATH that has no docker on it.
// Prints what isDockerServiceEnabled("postgres_plain") returns for each way a
// service can be configured. CI is inherited from the spawn env because the
// harness reads it at import time.
import { isDockerServiceEnabled } from "harness";

for (const key of Object.keys(process.env)) {
  if (key.startsWith("BUN_TEST_SERVICE_") || key === "BUN_DOCKER_COORDINATOR") {
    delete process.env[key];
  }
}

function gate(env: Record<string, string>): boolean | "threw" {
  Object.assign(process.env, env);
  try {
    return isDockerServiceEnabled("postgres_plain");
  } catch {
    return "threw";
  } finally {
    for (const key of Object.keys(env)) delete process.env[key];
  }
}

console.log(
  JSON.stringify({
    unconfigured: gate({}),
    override: gate({ BUN_TEST_SERVICE_postgres_plain: "127.0.0.1:5432" }),
    // serviceFromEnv() in test/docker/index.ts ignores an empty value, so the
    // gate has to fall through to the docker probe for it as well.
    emptyOverride: gate({ BUN_TEST_SERVICE_postgres_plain: "" }),
    overrideForAnotherService: gate({ BUN_TEST_SERVICE_mysql_plain: "127.0.0.1" }),
    coordinator: gate({ BUN_DOCKER_COORDINATOR: "/nonexistent/bun-docker.sock" }),
  }),
);

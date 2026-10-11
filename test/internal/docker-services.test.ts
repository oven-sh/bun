/**
 * scripts/docker-services.ts reads which docker-compose services a test file asks for from
 * the source of that file. scripts/runner.node.ts uses the answer to run those files after
 * the other serial files of the shard, to keep them out of the `bun test --parallel` bucket,
 * and to tell test/docker/coordinator.ts which services to start when the shard launches.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux, nodeExe, tempDir } from "harness";
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  dockerServicesFor,
  dockerServicesForShard,
  helperServices,
  isDockerBacked,
  servicesInSource,
} from "../../scripts/docker-services.ts";
import { serviceNames } from "../docker/service-names.mts";

const testsDir = join(import.meta.dir, "..");

// This file holds requests as fixture text. The rule must not read them as requests that this
// file makes, so the two names that open a request are put together here.
const harnessCall = "describeWith" + "Container";
const dockerIndex = "docker/" + "index.ts";

// Two real test files: one asks for postgres_plain, one talks to a mock server only.
const asksForPostgres = "js/sql/sql-begin-commit-rolled-back.test.ts";
const asksForNothing = "js/sql/sql-mysql-auth-short-nonce.test.ts";

test("service-names.mts lists the services of docker-compose.yml", () => {
  const compose = Bun.YAML.parse(readFileSync(join(testsDir, "docker", "docker-compose.yml"), "utf8"));
  expect<string[]>([...serviceNames].sort()).toEqual(Object.keys((compose as { services: object }).services).sort());
});

describe("servicesInSource", () => {
  test("each literal image in a file that calls the container harness", () => {
    expect(
      servicesInSource(`
        import { ${harnessCall} } from "harness";
        ${harnessCall}("postgres", { image: "postgres_plain" }, container => {});
        ${harnessCall}("mysql", { image: 'mysql_plain', concurrent: true }, container => {});
      `),
    ).toEqual(["mysql_plain", "postgres_plain"]);
  });

  test("mysql:8 and mysql:9 are both services the harness chooses between", () => {
    expect(servicesInSource(`${harnessCall}("mysql", { image: "mysql:8", env: {} }, () => {});`)).toEqual([
      "mysql_native_password",
      "mysql_plain",
    ]);
    expect(servicesInSource(`${harnessCall}("mysql", { image: "mysql:9" }, () => {});`)).toEqual([
      "mysql_native_password",
      "mysql_plain",
    ]);
  });

  test("an image that reaches the harness through a table", () => {
    expect(
      servicesInSource(`
        const images = [{ name: "MySQL", image: "mysql_plain" }, { name: "MySQL with TLS", image: "mysql_tls" }];
        for (const image of images) ${harnessCall}(image.name, { image: image.image }, () => {});
      `),
    ).toEqual(["mysql_plain", "mysql_tls"]);
  });

  test("a service name as the first argument of a call, in a file that imports docker/index.ts", () => {
    expect(
      servicesInSource(`
        import * as dockerCompose from "../../${dockerIndex}";
        const info = await dockerCompose.ensure("postgres_plain");
      `),
    ).toEqual(["postgres_plain"]);
    expect(
      servicesInSource(`
        const dockerCompose = require("../../../${dockerIndex}");
        beforeAll(async () => { squidInfo = await dockerCompose.ensure("squid"); });
      `),
    ).toEqual(["squid"]);
    // The rule keys on the service name, not on the name of the function.
    expect(
      servicesInSource(`
        import { awaitService } from "../../${dockerIndex}";
        const [pg, mysql] = await Promise.all([awaitService("postgres_plain"), awaitService('mysql_plain')]);
      `),
    ).toEqual(["mysql_plain", "postgres_plain"]);
  });

  test("text that only looks like a request", () => {
    const notRequests = {
      "a comment that names the harness, with no call": `
        // Anything a real server can produce belongs in ${harnessCall}.
        const server = mockServer({ image: "postgres_plain" });
      `,
      "an image in data, with no call": `
        expect(YAML.parse('image: "postgres_plain"')).toEqual({ image: "postgres_plain" });
      `,
      "an image that is not a compose service": `
        ${harnessCall}("x", { image: "postgres:13" }, () => {});
      `,
      "an image the file computes": `
        ${harnessCall}("x", { image: \`postgres_\${variant}\` }, () => {});
      `,
      "a local function with the same name as a docker/index.ts export": `
        function ensure(name) {}
        function envFor(name) {}
        await ensure("squid");
        envFor("postgres_plain");
      `,
      "an import of docker/index.ts with no service name in a call": `
        import { ensureDocker } from "../../${dockerIndex}";
        const squid = "squid";
        await Bun.spawn(["docker", "run", "-d", "squid"]).exited;
      `,
    };
    expect(
      Object.fromEntries(Object.entries(notRequests).map(([why, source]) => [why, servicesInSource(source)])),
    ).toEqual(Object.fromEntries(Object.keys(notRequests).map(why => [why, []])));
  });
});

describe("a test file", () => {
  /** The services the rule names for the file, or null when the file is not docker-backed. */
  const asksFor = (root: string, path: string) => (isDockerBacked(root, path) ? dockerServicesFor(root, path) : null);

  const files = {
    "js/sql/asks.test.ts": `${harnessCall}("postgres", { image: "postgres_plain" }, () => {});`,
    // Like test/js/sql/sql-mysql-row-decode-error.test.ts: the name says mysql, the file asks for mariadb.
    "js/sql/sql-mysql-decode.test.ts": `${harnessCall}("mariadb", { image: "mariadb_plain" }, () => {});`,
    "js/sql/sql-mysql-mock.test.ts": `// belongs in ${harnessCall}.\ntest("mock server", () => {});`,
    // The file asks for a service that the rule cannot name.
    "js/sql/computed.test.ts": `${harnessCall}("postgres", { image: \`postgres_\${variant}\` }, () => {});`,
    "js/valkey/test-utils.ts": `import * as dockerCompose from "../../${dockerIndex}";\nawait dockerCompose.ensure("redis_unified");`,
    "js/valkey/unit/imports-helper.test.ts": `import { createClient } from "../test-utils";`,
    "js/valkey/requires-helper.test.ts": `const { createClient } = require("./test-utils.ts");`,
    "js/valkey/mock.test.ts": `import net from "node:net";\ntest("mock server", () => {});`,
    // A helper with the same name in another directory is not in helperServices.
    "js/other/test-utils.ts": `export const createClient = () => {};`,
    "js/other/imports-other-helper.test.ts": `import { createClient } from "./test-utils";`,
  };
  const testPaths = [
    ...Object.keys(files).filter(path => path.endsWith(".test.ts")),
    // The runner can list a file that another process removes.
    "js/sql/missing.test.ts",
  ];

  test("is docker-backed when it asks for a service, with the services the rule can name", () => {
    using dir = tempDir("docker-services", files);
    const root = String(dir);
    expect(Object.fromEntries(testPaths.map(path => [path, asksFor(root, path)]))).toEqual({
      "js/sql/asks.test.ts": ["postgres_plain"],
      "js/sql/sql-mysql-decode.test.ts": ["mariadb_plain"],
      "js/sql/sql-mysql-mock.test.ts": null,
      "js/sql/computed.test.ts": [],
      "js/valkey/unit/imports-helper.test.ts": ["redis_unified"],
      "js/valkey/requires-helper.test.ts": ["redis_unified"],
      "js/valkey/mock.test.ts": null,
      "js/other/imports-other-helper.test.ts": null,
      "js/sql/missing.test.ts": null,
    });
    // The runner passes the separators of its platform.
    expect(asksFor(root, "js\\valkey\\unit\\imports-helper.test.ts")).toEqual(["redis_unified"]);
  });

  test("a shard starts the union of what its files ask for, and nothing without such a file", () => {
    using dir = tempDir("docker-services-shard", files);
    const root = String(dir);
    expect(dockerServicesForShard(root, testPaths)).toEqual(["mariadb_plain", "postgres_plain", "redis_unified"]);
    expect(dockerServicesForShard(root, ["js/sql/asks.test.ts", "js/sql/sql-mysql-mock.test.ts"])).toEqual([
      "postgres_plain",
    ]);
    expect(dockerServicesForShard(root, ["js/sql/sql-mysql-mock.test.ts", "js/valkey/mock.test.ts"])).toEqual([]);
    expect(dockerServicesForShard(root, [])).toEqual([]);
  });

  test("in the real tree", () => {
    expect(asksFor(testsDir, asksForPostgres)).toEqual(["postgres_plain"]);
    expect(asksFor(testsDir, asksForPostgres.replaceAll("/", "\\"))).toEqual(["postgres_plain"]);
    expect(asksFor(testsDir, asksForNothing)).toBeNull();
    // This file holds requests as text only.
    expect(asksFor(testsDir, "internal/docker-services.test.ts")).toBeNull();
  });

  test("each helperServices entry names what the helper module asks for", () => {
    const asksInSource = (helper: string) => servicesInSource(readFileSync(join(testsDir, `${helper}.ts`), "utf8"));
    expect(Object.fromEntries(Object.keys(helperServices).map(helper => [helper, asksInSource(helper)]))).toEqual(
      Object.fromEntries(Object.entries(helperServices).map(([helper, services]) => [helper, [...services].sort()])),
    );
  });
});

// CI starts the coordinator on Linux only.
describe.skipIf(!isLinux)("test/docker/coordinator.ts", () => {
  /** Starts the coordinator with `argv`, then asks it for mysql_plain the way a test does. */
  async function startThenRequest(argv: string[], env: Record<string, string> = {}) {
    using dir = tempDir("coord", {});
    const socket = join(String(dir), "c.sock");
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(testsDir, "docker", "coordinator.ts"), ...argv],
      env: {
        ...bunEnv,
        BUN_DOCKER_COORDINATOR_SOCKET: socket,
        // ensure() answers from these without docker.
        BUN_TEST_SERVICE_postgres_plain: "127.0.0.1",
        BUN_TEST_SERVICE_mysql_plain: "127.0.0.1",
        ...env,
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = proc.stderr.text();

    let stdout = "";
    const ready = Promise.withResolvers<void>();
    const drained = (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of proc.stdout) {
        stdout += decoder.decode(chunk, { stream: true });
        if (stdout.includes("COORDINATOR_READY")) ready.resolve();
      }
      ready.reject(new Error(`the coordinator exited before COORDINATOR_READY. stdout: ${stdout}`));
    })();
    await ready.promise;

    // By now the coordinator has started what is on argv. It does that right after it prints
    // COORDINATOR_READY, before it can accept a connection.
    const reply = await new Promise<string>((resolve, reject) => {
      let buffer = "";
      Bun.connect({
        unix: socket,
        socket: {
          open: client => void client.write(JSON.stringify({ type: "ensure", service: "mysql_plain" }) + "\n"),
          data(client, chunk) {
            buffer += chunk.toString();
            if (buffer.includes("\n")) client.end();
          },
          close: () => resolve(buffer),
          error: (_, error) => reject(error),
          connectError: (_, error) => reject(error),
        },
      }).catch(reject);
    });

    // The coordinator exits when its stdin closes.
    proc.stdin.end();
    await drained;
    const lines = (text: string) => text.replaceAll(socket, "<socket>").split("\n");
    return {
      stdout: lines(stdout.trim()),
      // What the coordinator logs. A sanitizer build can print other lines.
      stderr: lines(await stderr).filter(line => line.startsWith("coordinator:")),
      reply: JSON.parse(reply),
      exitCode: await proc.exited,
    };
  }

  const mysqlReply = { ok: true, info: { host: "127.0.0.1", ports: { "3306": 3306 } } };
  // Only a debug build needs more than the default: there the coordinator takes several seconds to start.
  // No CI lane runs one.
  const timeout = isDebug ? 30_000 : undefined;

  test.concurrent(
    "starts each service on argv once at launch, and any other service on request",
    async () => {
      // An argument that is not a service name, such as a test path, starts nothing.
      const argv = ["postgres_plain", "postgres_plain", "not_a_service", asksForPostgres];
      expect(await startThenRequest(argv)).toEqual({
        stdout: [
          "COORDINATOR_READY <socket>",
          "coordinator: ensuring postgres_plain",
          "coordinator: postgres_plain ready",
          "coordinator: ensuring mysql_plain",
          "coordinator: mysql_plain ready",
        ],
        stderr: [],
        reply: mysqlReply,
        exitCode: 0,
      });
    },
    timeout,
  );

  test.concurrent(
    "starts nothing at launch with no service on argv",
    async () => {
      expect(await startThenRequest([])).toEqual({
        stdout: ["COORDINATOR_READY <socket>", "coordinator: ensuring mysql_plain", "coordinator: mysql_plain ready"],
        stderr: [],
        reply: mysqlReply,
        exitCode: 0,
      });
    },
    timeout,
  );

  test.concurrent(
    "reports a service that failed to start at launch when a test asks for it",
    async () => {
      // A value with no host makes ensure() throw, so the start fails without docker.
      const failure = 'BUN_TEST_SERVICE_mysql_plain: missing host in ":3306"';
      expect(await startThenRequest(["mysql_plain"], { BUN_TEST_SERVICE_mysql_plain: ":3306" })).toEqual({
        // One start at launch, one for the request.
        stdout: [
          "COORDINATOR_READY <socket>",
          "coordinator: ensuring mysql_plain",
          "coordinator: ensuring mysql_plain",
        ],
        stderr: [
          `coordinator: mysql_plain failed: Error: ${failure}`,
          `coordinator: mysql_plain failed: Error: ${failure}`,
        ],
        reply: { ok: false, error: failure },
        exitCode: 0,
      });
    },
    timeout,
  );
});

// The runner starts the coordinator only in CI on Linux, and only when `docker compose version` works.
describe.skipIf(!isLinux || !nodeExe())("scripts/runner.node.ts", () => {
  /** Runs the runner over `testPaths` with stand-ins for bun, docker and who, and reports what it started. */
  async function runRunner(testPaths: string[]) {
    using dir = tempDir("docker-services-runner", {
      "docker": `#!/bin/sh\n[ "$*" = "compose version" ]\n`,
      // A CI runner stays alive while somebody is logged in.
      "who": `#!/bin/sh\n`,
      // Stands in for the bun under test. It answers the runner's probe, records how the runner starts
      // the coordinator and which test files it runs, and fails the ci-remap-server install so that
      // the runner skips that server.
      "bun": `#!/bin/sh
case "$1" in
  --print) echo "$0" ;;
  */coordinator.ts) printf '%s\\n' "$@" > "$0.coordinator" && echo COORDINATOR_READY && exec cat > /dev/null ;;
  install) exit 1 ;;
  test) for arg; do file=$arg; done; echo "$file" >> "$0.tests" ;;
esac
`,
    });
    const bin = String(dir);
    for (const name of ["docker", "who", "bun"]) chmodSync(join(bin, name), 0o755);
    // The job this test runs in can be a Buildkite job. The runner under test is not one.
    const env = Object.fromEntries(
      Object.entries(bunEnv).filter(([name]) => !/^(BUILDKITE|GITHUB_|EXPECTED_PLATFORM_)/.test(name)),
    );
    await using proc = Bun.spawn({
      cmd: [
        nodeExe()!,
        join(testsDir, "..", "scripts", "runner.node.ts"),
        `--exec-path=${join(bin, "bun")}`,
        ...testPaths.map(testPath => `--include=${testPath}`),
        "--shard=0",
        "--max-shards=1",
        "--retries=0",
        "--vendor=false",
        "--quiet",
      ],
      env: { ...env, PATH: `${bin}:${process.env.PATH}`, CI: "true" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = (name: string) => {
      try {
        return readFileSync(join(bin, name), "utf8").trim().split("\n");
      } catch {
        return [];
      }
    };
    return {
      coordinatorArgv: lines("bun.coordinator"),
      ran: lines("bun.tests").map(file => file.slice(testsDir.length + 1)),
      // The output of the runner explains a failure. It is not part of what a passing run must match.
      exit: exitCode === 0 ? 0 : { exitCode, stdout, stderr },
    };
  }

  const coordinator = join(testsDir, "docker", "coordinator.ts");

  // asksForNothing sorts after asksForPostgres, so it runs first only because the runner moves
  // the docker-backed file to the end.
  test.concurrent("passes the services of the shard's files to the coordinator and runs those files last", async () => {
    expect(await runRunner([asksForPostgres, asksForNothing])).toEqual({
      coordinatorArgv: [coordinator, "postgres_plain"],
      ran: [asksForNothing, asksForPostgres],
      exit: 0,
    });
  });

  test.concurrent("passes no service to the coordinator for a shard with no docker-backed file", async () => {
    expect(await runRunner([asksForNothing])).toEqual({
      coordinatorArgv: [coordinator],
      ran: [asksForNothing],
      exit: 0,
    });
  });
});

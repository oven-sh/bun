import { write } from "bun";
import { expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

setDefaultTimeout(1000 * 60 * 5);

function install(cwd: string, args: string[]) {
  const exec = Bun.spawnSync({
    cmd: [bunExe(), ...args, "--linker=hoisted"],
    cwd,
    stdout: "inherit",
    stdin: "inherit",
    stderr: "inherit",
    env: bunEnv,
  });
  if (exec.exitCode !== 0) {
    throw new Error(`bun install exited with code ${exec.exitCode}`);
  }
  return exec;
}

function installExpectFail(cwd: string, args: string[]) {
  const exec = Bun.spawnSync({
    cmd: [bunExe(), ...args],
    cwd,
    stdout: "inherit",
    stdin: "inherit",
    stderr: "inherit",
    env: bunEnv,
  });
  if (exec.exitCode === 0) {
    throw new Error(`bun install exited with code ${exec.exitCode}, (expected failure)`);
  }
  return exec;
}

function versionOf(cwd: string, path: string) {
  const data = readFileSync(join(cwd, path));
  const json = JSON.parse(data.toString());
  return json.version;
}

function ensureLockfileDoesntChangeOnBunI(cwd: string) {
  install(cwd, ["install"]);
  const lockb1 = readFileSync(join(cwd, "bun.lock"));
  install(cwd, ["install", "--frozen-lockfile"]);
  install(cwd, ["install", "--force"]);
  const lockb2 = readFileSync(join(cwd, "bun.lock"));

  expect(lockb1.toString("hex")).toEqual(lockb2.toString("hex"));
}

test("overrides affect your own packages", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {},
      overrides: {
        lodash: "4.0.0",
      },
    }),
  );
  install(tmp, ["install", "lodash"]);
  expect(versionOf(tmp, "node_modules/lodash/package.json")).toBe("4.0.0");
  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("overrides affects all dependencies", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {},
      overrides: {
        bytes: "1.0.0",
      },
    }),
  );
  install(tmp, ["install", "express@4.18.2"]);
  expect(versionOf(tmp, "node_modules/bytes/package.json")).toBe("1.0.0");

  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("overrides being set later affects all dependencies", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {},
    }),
  );
  install(tmp, ["install", "express@4.18.2"]);
  expect(versionOf(tmp, "node_modules/bytes/package.json")).not.toBe("1.0.0");

  ensureLockfileDoesntChangeOnBunI(tmp);

  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      ...JSON.parse(readFileSync(join(tmp, "package.json")).toString()),
      overrides: {
        bytes: "1.0.0",
      },
    }),
  );
  install(tmp, ["install"]);
  expect(versionOf(tmp, "node_modules/bytes/package.json")).toBe("1.0.0");

  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("overrides to npm specifier", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {},
      overrides: {
        bytes: "npm:lodash@4.0.0",
      },
    }),
  );
  install(tmp, ["install", "express@4.18.2"]);

  const bytes = JSON.parse(readFileSync(join(tmp, "node_modules/bytes/package.json"), "utf-8"));

  expect(bytes.name).toBe("lodash");
  expect(bytes.version).toBe("4.0.0");

  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("changing overrides makes the lockfile changed, prevent frozen install", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {},
      overrides: {
        bytes: "1.0.0",
      },
    }),
  );
  install(tmp, ["install", "express@4.18.2"]);

  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      ...JSON.parse(readFileSync(join(tmp, "package.json")).toString()),
      overrides: {
        bytes: "1.0.1",
      },
    }),
  );

  installExpectFail(tmp, ["install", "--frozen-lockfile"]);
});

test("overrides reset when removed", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      overrides: {
        bytes: "1.0.0",
      },
    }),
  );
  install(tmp, ["install", "express@4.18.2"]);
  expect(versionOf(tmp, "node_modules/bytes/package.json")).toBe("1.0.0");

  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      ...JSON.parse(readFileSync(join(tmp, "package.json")).toString()),
      overrides: undefined,
    }),
  );
  install(tmp, ["install"]);
  expect(versionOf(tmp, "node_modules/bytes/package.json")).not.toBe("1.0.0");

  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("$ override takes the referenced dependency's version but keeps the package's identity", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {
        "react": "18.3.1",
        "react-is": "18.2.0",
      },
      overrides: {
        "react-is": "$react",
      },
    }),
  );
  install(tmp, ["install"]);

  // react-is must stay react-is, only its version comes from "$react"
  const reactIs = JSON.parse(readFileSync(join(tmp, "node_modules/react-is/package.json"), "utf-8"));
  expect(reactIs.name).toBe("react-is");
  expect(reactIs.version).toBe("18.3.1");

  const react = JSON.parse(readFileSync(join(tmp, "node_modules/react/package.json"), "utf-8"));
  expect(react.name).toBe("react");

  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("multiple packages using the same $ override target stay independent", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {
        "react": "18.3.1",
        "react-dom": "18.2.0",
        "react-is": "18.2.0",
      },
      overrides: {
        "react-dom": "$react",
        "react-is": "$react",
      },
    }),
  );
  install(tmp, ["install"]);

  for (const pkg of ["react", "react-dom", "react-is"]) {
    const json = JSON.parse(readFileSync(join(tmp, "node_modules", pkg, "package.json"), "utf-8"));
    expect(json.name).toBe(pkg);
    expect(json.version).toBe("18.3.1");
  }

  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("$ reference in resolutions keeps the package's identity", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {
        "react": "18.3.1",
        "react-is": "18.2.0",
      },
      resolutions: {
        "react-is": "$react",
      },
    }),
  );
  install(tmp, ["install"]);

  const reactIs = JSON.parse(readFileSync(join(tmp, "node_modules/react-is/package.json"), "utf-8"));
  expect(reactIs.name).toBe("react-is");
  expect(reactIs.version).toBe("18.3.1");

  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("$ override referencing a missing dependency warns and keeps the original version", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {
        bytes: "1.0.0",
      },
      overrides: {
        bytes: "$nonexistent-reference",
      },
    }),
  );

  const { exitCode, stderr } = Bun.spawnSync({
    cmd: [bunExe(), "install"],
    cwd: tmp,
    stdout: "inherit",
    stdin: "inherit",
    stderr: "pipe",
    env: bunEnv,
  });

  expect(stderr.toString()).toContain(
    'Could not resolve override "$nonexistent-reference" (you need "nonexistent-reference" in your dependencies)',
  );
  expect(exitCode).toBe(0);
  expect(versionOf(tmp, "node_modules/bytes/package.json")).toBe("1.0.0");
});

test("overrides do not apply to workspaces", async () => {
  const tmp = tmpdirSync();
  await Promise.all([
    write(
      join(tmp, "package.json"),
      JSON.stringify({ name: "monorepo-root", workspaces: ["packages/*"], overrides: { "pkg1": "file:pkg2" } }),
    ),
    write(
      join(tmp, "packages", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        version: "1.1.1",
      }),
    ),
    write(
      join(tmp, "pkg2", "package.json"),
      JSON.stringify({
        name: "pkg2",
        version: "2.2.2",
      }),
    ),
  ]);

  let { exited, stderr } = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: tmp,
    env: bunEnv,
    stderr: "pipe",
    stdout: "inherit",
  });

  expect(await exited).toBe(0);
  expect(await stderr.text()).toContain("Saved lockfile");

  // --frozen-lockfile works
  ({ exited, stderr } = Bun.spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile"],
    cwd: tmp,
    env: bunEnv,
    stderr: "pipe",
    stdout: "inherit",
  }));

  expect(await exited).toBe(0);
  expect(await stderr.text()).not.toContain("Frozen lockfile");

  // lockfile is not changed

  ({ exited, stderr } = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: tmp,
    env: bunEnv,
    stderr: "pipe",
    stdout: "inherit",
  }));

  expect(await exited).toBe(0);
  expect(await stderr.text()).not.toContain("Saved lockfile");
});

import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { access, mkdir, writeFile } from "fs/promises";
import {
  bunExe,
  bunEnv as env,
  isWindows,
  readdirSorted,
  runBunInstall,
  stderrForInstall,
  tmpdirSync,
  toBeValidBin,
  toHaveBins,
} from "harness";
import { basename, join } from "path";
import { dummyAfterAll, dummyAfterEach, dummyBeforeAll, dummyBeforeEach, package_dir } from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

let link_dir: string;

expect.extend({
  toBeValidBin,
  toHaveBins,
});

beforeEach(async () => {
  link_dir = tmpdirSync();
  await dummyBeforeEach({ linker: "hoisted" });
});
afterEach(async () => {
  await dummyAfterEach();
});

it("should link and unlink workspace package", async () => {
  await writeFile(
    join(link_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      workspaces: ["packages/*"],
    }),
  );
  await mkdir(join(link_dir, "packages", "moo"), { recursive: true });
  await mkdir(join(link_dir, "packages", "boba"), { recursive: true });
  await writeFile(
    join(link_dir, "packages", "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.0.1",
    }),
  );
  await writeFile(
    join(link_dir, "packages", "boba", "package.json"),
    JSON.stringify({
      name: "boba",
      version: "0.0.1",
    }),
  );
  let { out, err } = await runBunInstall(env, link_dir);
  expect(err.split(/\r?\n/).slice(-2)).toEqual(["Saved lockfile", ""]);
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun install v1."),
    "",
    "Done! Checked 3 packages (no changes)",
  ]);

  let { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "link"],
    cwd: join(link_dir, "packages", "moo"),
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  err = stderrForInstall(await stderr.text());
  expect(err.split(/\r?\n/)).toEqual([""]);
  expect(await stdout.text()).toContain(`Success! Registered "moo"`);
  expect(await exited).toBe(0);

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "link", "moo", "--linker=hoisted"],
    cwd: join(link_dir, "packages", "boba"),
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = stderrForInstall(await stderr.text());
  expect(err.split(/\r?\n/)).toEqual([""]);
  expect((await stdout.text()).replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun link v1."),
    "",
    `installed moo@link:moo`,
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(await file(join(link_dir, "packages", "boba", "node_modules", "moo", "package.json")).json()).toEqual({
    name: "moo",
    version: "0.0.1",
  });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "unlink"],
    cwd: join(link_dir, "packages", "moo"),
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = stderrForInstall(await stderr.text());
  expect(err.split(/\r?\n/)).toEqual([""]);
  expect(await stdout.text()).toContain(`success: unlinked package "moo"`);
  expect(await exited).toBe(0);

  // link the workspace root package to a workspace package
  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "link"],
    cwd: link_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = stderrForInstall(await stderr.text());
  expect(err.split(/\r?\n/)).toEqual([""]);
  expect(await stdout.text()).toContain(`Success! Registered "foo"`);
  expect(await exited).toBe(0);

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "link", "foo", "--linker=hoisted"],
    cwd: join(link_dir, "packages", "boba"),
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = stderrForInstall(await stderr.text());
  expect(err.split(/\r?\n/)).toEqual([""]);
  expect((await stdout.text()).replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun link v1."),
    "",
    `installed foo@link:foo`,
    "",
    "1 package installed",
  ]);
  expect(await file(join(link_dir, "packages", "boba", "node_modules", "foo", "package.json")).json()).toEqual({
    name: "foo",
    version: "1.0.0",
    workspaces: ["packages/*"],
  });
  expect(await exited).toBe(0);

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "unlink"],
    cwd: link_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = stderrForInstall(await stderr.text());
  expect(err.split(/\r?\n/)).toEqual([""]);
  expect(await stdout.text()).toContain(`success: unlinked package "foo"`);
  expect(await exited).toBe(0);
});

it("should link package", async () => {
  const link_name = basename(link_dir).slice("bun-link.".length);
  await writeFile(
    join(link_dir, "package.json"),
    JSON.stringify({
      name: link_name,
      version: "0.0.1",
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.2",
    }),
  );

  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "link"],
    cwd: link_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err1 = stderrForInstall(await new Response(stderr1).text());
  expect(err1.split(/\r?\n/)).toEqual([""]);
  expect(await new Response(stdout1).text()).toContain(`Success! Registered "${link_name}"`);
  expect(await exited1).toBe(0);

  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "link", link_name],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err2 = stderrForInstall(await new Response(stderr2).text());
  expect(err2.split(/\r?\n/)).toEqual([""]);
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun link v1."),
    "",
    `installed ${link_name}@link:${link_name}`,
    "",
    "1 package installed",
  ]);
  expect(await exited2).toBe(0);

  const {
    stdout: stdout3,
    stderr: stderr3,
    exited: exited3,
  } = spawn({
    cmd: [bunExe(), "unlink"],
    cwd: link_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err3 = stderrForInstall(await new Response(stderr3).text());
  expect(err3.split(/\r?\n/)).toEqual([""]);
  expect(await new Response(stdout3).text()).toContain(`success: unlinked package "${link_name}"`);
  expect(await exited3).toBe(0);

  const {
    stdout: stdout4,
    stderr: stderr4,
    exited: exited4,
  } = spawn({
    cmd: [bunExe(), "link", link_name],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err4 = stderrForInstall(await new Response(stderr4).text());
  expect(err4).toContain(`error: Package "${link_name}" is not linked`);
  expect(await new Response(stdout4).text()).toEqual(expect.stringContaining("bun link v1."));
  expect(await exited4).toBe(1);
});

it("should link scoped package", async () => {
  const link_name = `@${basename(link_dir).slice("bun-link.".length)}/foo`;
  await writeFile(
    join(link_dir, "package.json"),
    JSON.stringify({
      name: link_name,
      version: "0.0.1",
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "bar",
      version: "0.0.2",
    }),
  );

  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "link"],
    cwd: link_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err1 = stderrForInstall(await new Response(stderr1).text());
  expect(err1.split(/\r?\n/)).toEqual([""]);
  expect(await new Response(stdout1).text()).toContain(`Success! Registered "${link_name}"`);
  expect(await exited1).toBe(0);

  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "link", link_name],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err2 = stderrForInstall(await new Response(stderr2).text());
  expect(err2.split(/\r?\n/)).toEqual([""]);
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun link v1."),
    "",
    `installed ${link_name}@link:${link_name}`,
    "",
    "1 package installed",
  ]);
  expect(await exited2).toBe(0);

  const {
    stdout: stdout3,
    stderr: stderr3,
    exited: exited3,
  } = spawn({
    cmd: [bunExe(), "unlink"],
    cwd: link_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err3 = stderrForInstall(await new Response(stderr3).text());
  expect(err3.split(/\r?\n/)).toEqual([""]);
  expect(await new Response(stdout3).text()).toContain(`success: unlinked package "${link_name}"`);
  expect(await exited3).toBe(0);

  const {
    stdout: stdout4,
    stderr: stderr4,
    exited: exited4,
  } = spawn({
    cmd: [bunExe(), "link", link_name],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err4 = stderrForInstall(await new Response(stderr4).text());
  expect(err4).toContain(`error: Package "${link_name}" is not linked`);
  expect((await new Response(stdout4).text()).split(/\r?\n/)).toEqual([expect.stringContaining("bun link v1."), ""]);
  expect(await exited4).toBe(1);
});

it("should link dependency without crashing", async () => {
  const link_name = basename(link_dir).slice("bun-link.".length) + "-really-long-name";
  await writeFile(
    join(link_dir, "package.json"),
    JSON.stringify({
      name: link_name,
      version: "0.0.1",
      bin: {
        [link_name]: `${link_name}.py`,
      },
    }),
  );
  // Use a Python script with \r\n shebang to test normalization
  await writeFile(join(link_dir, `${link_name}.py`), "#!/usr/bin/env python\r\nprint('hello from python')");
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.2",
      dependencies: {
        [link_name]: `link:${link_name}`,
      },
    }),
  );

  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "link"],
    cwd: link_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err1 = stderrForInstall(await new Response(stderr1).text());
  expect(err1.split(/\r?\n/)).toEqual([""]);
  expect(await new Response(stdout1).text()).toContain(`Success! Registered "${link_name}"`);
  expect(await exited1).toBe(0);

  const { out: stdout2, err: stderr2, exited: exited2 } = await runBunInstall(env, package_dir);
  const err2 = stderrForInstall(await new Response(stderr2).text());
  expect(err2.split(/\r?\n/).slice(-2)).toEqual(["Saved lockfile", ""]);
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun install v1."),
    "",
    `+ ${link_name}@link:${link_name}`,
    "",
    "1 package installed",
  ]);
  expect(await exited2).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", link_name].sort());
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins([link_name]);
  expect(join(package_dir, "node_modules", ".bin", link_name)).toBeValidBin(join("..", link_name, `${link_name}.py`));
  expect(await readdirSorted(join(package_dir, "node_modules", link_name))).toEqual(
    ["package.json", `${link_name}.py`].sort(),
  );
  // Verify that the shebang was normalized from \r\n to \n (only on non-Windows)
  const binContent = await file(join(package_dir, "node_modules", link_name, `${link_name}.py`)).text();
  if (isWindows) {
    expect(binContent).toStartWith("#!/usr/bin/env python\r\nprint");
  } else {
    expect(binContent).toStartWith("#!/usr/bin/env python\nprint");
    expect(binContent).not.toContain("\r\n");
  }
  await access(join(package_dir, "bun.lockb"));

  const {
    stdout: stdout3,
    stderr: stderr3,
    exited: exited3,
  } = spawn({
    cmd: [bunExe(), "unlink"],
    cwd: link_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err3 = stderrForInstall(await new Response(stderr3).text());
  expect(err3.split(/\r?\n/)).toEqual([""]);
  expect(await new Response(stdout3).text()).toContain(`success: unlinked package "${link_name}"`);
  expect(await exited3).toBe(0);

  const {
    stdout: stdout4,
    stderr: stderr4,
    exited: exited4,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err4 = stderrForInstall(await new Response(stderr4).text());
  expect(err4).toContain(`FileNotFound: failed linking dependency/workspace to node_modules for package ${link_name}`);
  const out4 = await new Response(stdout4).text();
  expect(out4.replace(/\[[0-9\.]+m?s\]/, "[]").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun install v1."),
    "",
    "Failed to install 1 package",
    "[] done",
    "",
  ]);

  // This should fail with a non-zero exit code.
  expect(await exited4).toBe(1);
});

it("unlink <package> removes a link: dependency and its node_modules entry", async () => {
  const link_name = basename(link_dir).slice("bun-link.".length);
  await writeFile(
    join(link_dir, "package.json"),
    JSON.stringify({
      name: link_name,
      version: "0.0.1",
    }),
  );

  // Register the local package globally.
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "link"],
      cwd: link_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const [out, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(stderrForInstall(err).split(/\r?\n/)).toEqual([""]);
    expect(out).toContain(`Success! Registered "${link_name}"`);
    expect(code).toBe(0);
  }

  // Consumer depends on it through the link: protocol.
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "consumer",
      version: "0.0.1",
      dependencies: { [link_name]: `link:${link_name}` },
    }),
  );
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const [, , code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(code).toBe(0);
  }
  // The link: dependency is symlinked into node_modules.
  expect(await file(join(package_dir, "node_modules", link_name, "package.json")).json()).toEqual({
    name: link_name,
    version: "0.0.1",
  });

  // Unlink it from the consumer.
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "unlink", link_name],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const [, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(stderrForInstall(err)).not.toContain("error:");
    expect(code).toBe(0);
  }

  // The link: entry is removed from package.json and the node_modules entry is gone.
  const pkg = await file(join(package_dir, "package.json")).json();
  expect(pkg.dependencies?.[link_name]).toBeUndefined();
  expect(existsSync(join(package_dir, "node_modules", link_name))).toBe(false);
});

it("unlink <package> keeps a non-link: dependency and restores it", async () => {
  // A "published" copy of baz, installed through the file: protocol (no registry).
  await mkdir(join(package_dir, "local-baz"), { recursive: true });
  await writeFile(
    join(package_dir, "local-baz", "package.json"),
    JSON.stringify({
      name: "baz",
      version: "0.0.3",
    }),
  );

  // A different local baz registered globally, used to link over the file: copy.
  await writeFile(
    join(link_dir, "package.json"),
    JSON.stringify({
      name: "baz",
      version: "9.9.9",
    }),
  );
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "link"],
      cwd: link_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const [out, , code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(out).toContain(`Success! Registered "baz"`);
    expect(code).toBe(0);
  }

  // Consumer depends on the file: copy — a non-link: specifier.
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "consumer",
      version: "0.0.1",
      dependencies: { baz: "file:./local-baz" },
    }),
  );

  const readJson = (...parts: string[]) => JSON.parse(readFileSync(join(package_dir, ...parts), "utf8"));

  // Install the file: copy.
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const [, , code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(code).toBe(0);
  }
  expect(readJson("node_modules", "baz", "package.json").version).toBe("0.0.3");

  // Link the global copy over it (does not touch package.json).
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "link", "baz", "--linker=hoisted"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const [, , code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(code).toBe(0);
  }
  // node_modules holds the LINKED version; package.json keeps the file: specifier.
  expect(readJson("node_modules", "baz", "package.json").version).toBe("9.9.9");
  expect(readJson("package.json").dependencies.baz).toBe("file:./local-baz");

  // Unlink it: the non-link: specifier must be preserved and the file: copy reinstalled.
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "unlink", "baz", "--linker=hoisted"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const [, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(stderrForInstall(err)).not.toContain("error:");
    expect(code).toBe(0);
  }

  // package.json still has the file: specifier, and node_modules holds the file: copy again.
  expect(readJson("package.json").dependencies.baz).toBe("file:./local-baz");
  expect(readJson("node_modules", "baz", "package.json").version).toBe("0.0.3");
});

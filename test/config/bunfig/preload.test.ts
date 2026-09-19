import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";
import { join, resolve } from "path";

const fixturePath = (...segs: string[]) => resolve(import.meta.dirname, "fixtures", "preload", ...segs);

type Opts = {
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};
type Out = [stdout: string, stderr: string, exitCode: number];

// Every preload fixture records its own path in `globalThis.preload`, and every
// entry file prints that value. So `stdout` says exactly which preloads ran,
// and in what order.
async function run(file: string, { args = [], cwd, env = {} }: Opts = {}): Promise<Out> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args, file],
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, ...env },
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return [normalizeBunSnapshot(stdout, cwd), normalizeBunSnapshot(stderr, cwd), exitCode];
}

describe.concurrent("Given a single universal preload", () => {
  const dir = fixturePath("simple");

  // `bun run` looks for a `bunfig.toml` in the current directory by default
  it("When `bun run` is run and `bunfig.toml` is implicitly loaded, preloads are run", async () => {
    // `bun run index.ts`
    const [out, err, code] = await run("index.ts", { cwd: dir });
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`"simple/preload.ts"`);
    expect(code).toBe(0);
  });

  // FIXME: relative paths are being resolved to cwd, not the file's directory
  it.skip("When `bun run` is run from a different directory but bunfig.toml is explicitly used, preloads are run", async () => {
    // `bun run index.ts`
    const [out, err, code] = await run(join(dir, "index.ts"), {
      args: [`--config=${join(dir, "bunfig.toml")}`],
      cwd: process.cwd(),
    });
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`"simple/preload.ts"`);
    expect(code).toBe(0);
  });
}); // </given a single universal preload>

describe.concurrent("Given a bunfig.toml with both universal and test-only preloads", () => {
  const dir = fixturePath("mixed");

  it("`bun run index.ts` only loads the universal preload", async () => {
    const [out, err, code] = await run("index.ts", { cwd: dir });
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`"[ "mixed/preload-run.ts" ]"`);
    expect(code).toBe(0);
  });

  it("`bun test` only loads test-only preloads, clobbering the universal ones", async () => {
    const [out, err, code] = await run("./index.fixture-test.ts", { args: ["test"], cwd: dir });
    expect(err).toMatchInlineSnapshot(`
      "index.fixture-test.ts:
      (pass) the correct file was preloaded

       1 pass
       0 fail
       1 expect() calls
      Ran 1 test across 1 file."
    `);
    expect(out).toMatchInlineSnapshot(`
      "bun test <version> (<revision>)
      [ "mixed/preload-test.ts" ]"
    `);
    expect(code).toBe(0);
  });
}); // </given a bunfig.toml with both universal and test-only preloads>

describe.concurrent("Given a `bunfig.toml` with a list of preloads", () => {
  const dir = fixturePath("multi");

  it("When `bun run` is run, preloads are run", async () => {
    const [out, err, code] = await run("index.ts", { cwd: dir });
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`"[ "multi/preload1.ts", "multi/preload2.ts" ]"`);
    expect(code).toBe(0);
  });

  it("when passed `--config=bunfig.empty.toml`, preloads are not run", async () => {
    const [out, err, code] = await run("index.ts", { args: ["--config=bunfig.empty.toml"], cwd: dir });
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`"undefined"`);
    expect(code).toBe(0);
  });

  it.each([
    //
    "--preload ./preload3.ts",
    "--preload=./preload3.ts",
    // FIXME: Tests are failing due to active bugs
    // "--preload ./preload3.ts run",
    // "--preload=./preload3.ts run",
    // "run --preload ./preload3.ts",
    // "run --preload=./preload3.ts",
  ])("When `bun %s index.ts` is run, `--preload` adds the target file to the list of preloads", async args => {
    const [out, err, code] = await run("index.ts", { args: args.split(" "), cwd: dir });
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`"[ "multi/preload1.ts", "multi/preload2.ts", "multi/preload3.ts" ]"`);
    expect(code).toBe(0);
  });
}); // </given a `bunfig.toml` with a list of preloads>

describe.concurrent("Given a `bunfig.toml` with a plugin preload", () => {
  const dir = fixturePath("plugin");

  it("When `bun run` is run, preloads are run", async () => {
    const [out, err, code] = await run("index.ts", { cwd: dir });
    expect(err).toBeEmpty();
    expect(out).toBeEmpty();
    expect(code).toBe(0);
  });
}); // </given a `bunfig.toml` with a plugin preload>

describe.concurrent("Given a `bunfig.toml` file with a relative path to a preload in a parent directory", () => {
  const dir = fixturePath("parent", "foo");

  it("When `bun run` is run, preloads are run", async () => {
    const [out, err, code] = await run("index.ts", { cwd: dir });
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`"parent/preload.ts"`);
    expect(code).toBe(0);
  });
}); // </given a `bunfit.toml` file with a relative path to a preload in a parent directory>

describe.concurrent("Given a `bunfig.toml` file with a relative path without a leading './'", () => {
  const dir = fixturePath("relative");

  // FIXME: currently treaded as an import to an external package
  it.skip("preload = 'preload.ts' is treated like a relative path and loaded", async () => {
    const [out, err, code] = await run("index.ts", { cwd: dir });
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`"relative/preload.ts"`);
    expect(code).toBe(0);
  });
}); // </given a `bunfig.toml` file with a relative path without a leading './'>

describe.concurrent("Test that all the aliases for --preload work", () => {
  const dir = fixturePath("many");

  it.each(["--preload=./preload1.ts", "--require=./preload1.ts", "--import=./preload1.ts"])(
    "When `bun run` is run with %s, the preload is executed",
    async flag => {
      const [out, err, code] = await run("index.ts", { args: [flag], cwd: dir });
      expect(err).toBe("");
      expect(out).toMatchInlineSnapshot(`"[ "many/preload1.ts" ]"`);
      expect(code).toBe(0);
    },
  );

  it.each([
    "--preload ./preload1.ts --require ./preload2.ts --import ./preload3.ts",
    "--import ./preload3.ts --preload=./preload1.ts --require ./preload2.ts",
    "--require ./preload2.ts --import ./preload3.ts --preload ./preload1.ts",
    "--require ./preload1.ts --import ./preload3.ts --require ./preload2.ts",
  ])(
    "When multiple preload flags are used, they execute in order: --preload, --require, --import (`bun %s index.ts`)",
    async flags => {
      const [out, err, code] = await run("index.ts", { args: flags.split(" "), cwd: dir });
      expect(err).toBe("");
      expect(out).toMatchInlineSnapshot(`"[ "many/preload1.ts", "many/preload2.ts", "many/preload3.ts" ]"`);
      expect(code).toBe(0);
    },
  );

  it("Duplicate preload flags are only executed once", async () => {
    const args = ["--preload", "./preload1.ts", "--require", "./preload1.ts", "--import", "./preload1.ts"];
    const [out, err, code] = await run("index.ts", { args, cwd: dir });
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`"[ "many/preload1.ts" ]"`);
    expect(code).toBe(0);
  });

  it("Test double preload flags", async () => {
    const args = [
      "--preload",
      "./preload1.ts",
      "--preload=./preload2.ts",
      "--preload",
      "./preload3.ts",
      "-r",
      "./preload3.ts",
    ];
    const [out, err, code] = await run("index.ts", { args, cwd: dir });
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`"[ "many/preload1.ts", "many/preload2.ts", "many/preload3.ts" ]"`);
    expect(code).toBe(0);
  });
}); // </Test that all the aliases for --preload work>

test.concurrent("Test BUN_INSPECT_PRELOAD is used to set preloads", async () => {
  const dir = fixturePath("many");
  const [out, err, code] = await run("index.ts", { args: [], cwd: dir, env: { BUN_INSPECT_PRELOAD: "./preload1.ts" } });
  expect(err).toBe("");
  expect(out).toMatchInlineSnapshot(`"[ "many/preload1.ts" ]"`);
  expect(code).toBe(0);
}); // </Test BUN_INSPECT_PRELOAD is used to set preloads>

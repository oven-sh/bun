import type { SpawnOptions } from "bun";
import { bunEnv, bunExe } from "harness";
import { join, resolve } from "path";

const fixturePath = (...segs: string[]) => resolve(import.meta.dirname, "fixtures", "preload", ...segs);

type Opts = {
  args?: string[];
  cwd?: string;
};
type Out = [stdout: string, stderr: string, exitCode: number];
const run = (file: string, { args = [], cwd }: Opts = {}): Promise<Out> => {
  const res = Bun.spawn([bunExe(), ...args, file], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: bunEnv,
  } satisfies SpawnOptions.OptionsObject<"ignore", "pipe", "pipe">);

  return Promise.all([
    new Response(res.stdout).text().then(s => s.trim()),
    new Response(res.stderr).text().then(s => s.trim()),
    res.exited,
  ]);
};

describe("Given a single universal preload", () => {
  const dir = fixturePath("simple");

  // `bun run` looks for a `bunfig.toml` in the current directory by default
  it("When `bun run` is run and `bunfig.toml` is implicitly loaded, preloads are run", async () => {
    // `bun run index.ts`
    const [out, err, code] = await run("index.ts", { cwd: dir });
    expect(err).toBeEmpty();
    expect(out).toBeEmpty();
    expect(code).toBe(0);
  });

  // FIXME: relative paths are being resolved to cwd, not the file's directory
  it.skip("When `bun run` is run from a different directory but bunfig.toml is explicitly used, preloads are run", async () => {
    // `bun run index.ts`
    const [out, err, code] = await run(join(dir, "index.ts"), {
      args: [`--config=${join(dir, "bunfig.toml")}`],
      cwd: process.cwd(),
    });
    expect(err).toBeEmpty();
    expect(out).toBeEmpty();
    expect(code).toBe(0);
  });
}); // </given a single universal preload>

describe("Given a bunfig.toml with both universal and test-only preloads", () => {
  const dir = fixturePath("mixed");

  it("`bun run index.ts` only loads the universal preload", async () => {
    const [out, err, code] = await run("index.ts", { cwd: dir });
    expect(err).toBeEmpty();
    expect(out).toBeEmpty();
    expect(code).toBe(0);
  });

  it("`bun test` only loads test-only preloads, clobbering the universal ones", async () => {
    const [out, err, code] = await run("./index.fixture-test.ts", { args: ["test"], cwd: dir });
    // note: err has test report, out has "bun test <version>"

    expect(code).toBe(0);
  });
}); // </given a bunfig.toml with both universal and test-only preloads>

describe("Given a `bunfig.toml` with a list of preloads", () => {
  const dir = fixturePath("multi");

  it("When `bun run` is run, preloads are run", async () => {
    const [out, err, code] = await run("index.ts", { cwd: dir });
    expect(err).toBeEmpty();
    expect(out).toBeEmpty();
    expect(code).toBe(0);
  });

  it("when passed `--config=bunfig.empty.toml`, preloads are not run", async () => {
    const [out, err, code] = await run("empty.ts", { args: ["--config=bunfig.empty.toml"], cwd: dir });
    expect(err).toBeEmpty();
    expect(out).toBeEmpty();
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
  ])("When `bun %s cli-merge.ts` is run, `--preload` adds the target file to the list of preloads", async args => {
    const [out, err, code] = await run("cli-merge.ts", { args: args.split(" "), cwd: dir });
    expect(err).toBeEmpty();
    expect(out).toBeEmpty();
    expect(code).toBe(0);
  });
}); // </given a `bunfig.toml` with a list of preloads>

describe("Given a `bunfig.toml` with a plugin preload", () => {
  const dir = fixturePath("plugin");

  it.todo("When `bun run` is run, preloads are run", async () => {
    const [out, err, code] = await run("index.ts", { cwd: dir });
    expect(err).toBeEmpty();
    expect(out).toBeEmpty();
    expect(code).toBe(0);
  });
}); // </given a `bunfig.toml` with a plugin preload>

describe("Given a `bunfig.toml` file with a relative path to a preload in a parent directory", () => {
  const dir = fixturePath("parent", "foo");

  // FIXME
  it("When `bun run` is run, preloads are run", async () => {
    const [out, err, code] = await run("index.ts", { cwd: dir });
    expect(err).toBeEmpty();
    expect(out).toBeEmpty();
    expect(code).toBe(0);
  });
}); // </given a `bunfit.toml` file with a relative path to a preload in a parent directory>

describe("Given a `bunfig.toml` file with a relative path without a leading './'", () => {
  const dir = fixturePath("relative");

  // FIXME: currently treaded as an import to an external package
  it.skip("preload = 'preload.ts' is treated like a relative path and loaded", async () => {
    const [out, err, code] = await run("index.ts", { cwd: dir });
    expect(err).toBeEmpty();
    expect(out).toBeEmpty();
    expect(code).toBe(0);
  });
}); // </given a `bunfig.toml` file with a relative path without a leading './'>

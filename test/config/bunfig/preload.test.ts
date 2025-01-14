import { join, resolve } from "path";
import { bunExe, bunEnv } from "harness";
import type { SpawnOptions } from "bun";

const fixturePath = (...segs: string[]) => resolve(import.meta.dirname, "fixtures", "preload", ...segs);

type Opts = {
  subcommand?: "run" | "test";
  args?: string[];
  cwd?: string;
};
type Out = [stdout: string, stderr: string, exitCode: number];
const run = (file: string, { subcommand = "run", args = [], cwd }: Opts = {}): Promise<Out> => {
  const res = Bun.spawn([bunExe(), subcommand, ...args, file], {
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
    expect(err).toEqual("");
    expect(out).toEqual("");
    expect(code).toBe(0);
  });

  it("When `bun run` is run from a different directory  but bunfig.toml is explicitly used, preloads are run", async () => {
    // `bun run index.ts`
    const [out, err, code] = await run(join(dir, "index.ts"), {
      args: [`--config=${join(dir, "bunfig.toml")}`],
      cwd: process.cwd(),
    });
    expect(err).toEqual("");
    expect(out).toEqual("");
    expect(code).toBe(0);
  });
}); // </given a single universal preload>

describe("Given a bunfig.toml with both universal and test-only preloads", () => {
  const dir = fixturePath("mixed");

  it("`bun run index.ts` only loads the universal preload", async () => {
    const [out, err, code] = await run("index.ts", { cwd: dir });
    expect(err).toEqual("");
    expect(out).toEqual("");
    expect(code).toBe(0);
  });

  it("`bun test` only loads test-only preloads, clobbering the universal ones", async () => {
    const [out, err, code] = await run("./index.fixture-test.ts", { subcommand: "test", cwd: dir });
    // note: err has test report, out has "bun test <version>"

    expect(code).toBe(0);
  });
}); // </given a bunfig.toml with both universal and test-only preloads>

describe("Given a `bunfig.toml` with a list of preloads", () => {
  const dir = fixturePath("multi");

  it("When `bun run` is run, preloads are run", async () => {
    const [out, err, code] = await run("index.ts", { cwd: dir });
    expect(err).toEqual("");
    expect(out).toEqual("");
    expect(code).toBe(0);
  });

  it("when passed `--config=bunfig.empty.toml`, preloads are not run", async () => {
    const [out, err, code] = await run("empty.ts", { args: ["--config=bunfig.empty.toml"], cwd: dir });
    expect(err).toEqual("");
    expect(out).toEqual("");
    expect(code).toBe(0);
  });

  it("When `--preload=preload3.ts` is passed via CLI args, its added to the list of preloads", async () => {
    const [out, err, code] = await run("cli-merge.ts", { args: ["--preload=preload3.ts"], cwd: dir });
    expect(err).toEqual("");
    expect(out).toEqual("");
    expect(code).toBe(0);
  });
}); // </given a `bunfig.toml` with a list of preloads>

describe("Given a `bunfig.toml` with a plugin preload", () => {
  const dir = fixturePath("plugin");

  it("When `bun run` is run, preloads are run", async () => {
    const [out, err, code] = await run("index.ts", { cwd: dir });
    expect(err).toEqual("");
    expect(out).toEqual("");
    expect(code).toBe(0);
  });
}); // </given a `bunfig.toml` with a plugin preload>

describe("Given a `bunfit.toml` file with a relative path to a preload in a parent directory", () => {
  const dir = fixturePath("parent", "foo");

  it("When `bun run` is run, preloads are run", async () => {
    const [out, err, code] = await run("index.ts", { cwd: dir });
    expect(err).toEqual("");
    expect(out).toEqual("");
    expect(code).toBe(0);
  });
}); // </given a `bunfit.toml` file with a relative path to a preload in a parent directory>

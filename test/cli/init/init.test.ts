import type { SyncSubprocess } from "bun";
import { describe, beforeAll, afterAll, expect, test, it, jest } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import path from "path";

jest.setTimeout(30_000);

/** package.json, README.md not included */
const filesCreated = ["index.ts", ".gitignore", "node_modules", "tsconfig.json", "bunfig.toml"];

const defaultPackageJson = ({ name }) => ({
  "name": name,
  "module": "index.ts",
  "type": "module",
  "devDependencies": {
    "@types/bun": "latest",
  },
  "peerDependencies": {
    "typescript": "^5.0.0",
  },
});

describe("`bun init -y`", () => {
  let temp: string;
  let out: SyncSubprocess<"ignore", "inherit">;

  beforeAll(() => {
    temp = tmpdirSync();
    out = Bun.spawnSync({
      cmd: [bunExe(), "init", "-y"],
      cwd: temp,
      stdio: ["ignore", "ignore", "inherit"],
      env: bunEnv,
    });
  });

  afterAll(() => {
    Bun.$`rm -rf ${temp}`.nothrow();
  });

  it("exits successfully", () => {
    expect(out).not.toHaveProperty("signal");
    expect(out.exitCode).toBe(0);
  });

  it("creates the expected package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
    const expected = defaultPackageJson({ name: path.basename(temp).toLowerCase() });
    expect(pkg).toEqual(expected);
  });

  it("populates the README.md template", () => {
    const readme = fs.readFileSync(path.join(temp, "README.md"), "utf8");
    expect(readme).toStartWith("# " + path.basename(temp).toLowerCase() + "\n");
    expect(readme).toInclude("v" + Bun.version.replaceAll("-debug", ""));
    expect(readme).toInclude("index.ts");
  });

  it.each(filesCreated)("creates %s", file => {
    expect(fs.existsSync(path.join(temp, file))).toBeTrue();
  });
});

describe("`bun init` wth piped cli", () => {
  let temp: string;
  let out: SyncSubprocess;

  beforeAll(() => {
    temp = tmpdirSync();
    out = Bun.spawnSync({
      cmd: [bunExe(), "init"],
      cwd: temp,
      stdio: [new Blob(["\n".repeat(12)]), "ignore", "inherit"],
      env: bunEnv,
    });
  });

  afterAll(() => {
    Bun.$`rm -rf ${temp}`.nothrow();
  });

  it("exits successfully", () => {
    expect(out).not.toHaveProperty("signal");
    expect(out.exitCode).toBe(0);
  });

  it("creates the expected package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
    const expected = defaultPackageJson({ name: path.basename(temp).toLowerCase() });
    expect(pkg).toEqual(expected);
  });

  it("populates the README.md template", () => {
    const readme = fs.readFileSync(path.join(temp, "README.md"), "utf8");
    expect(readme).toStartWith("# " + path.basename(temp).toLowerCase() + "\n");
    expect(readme).toInclude("v" + Bun.version.replaceAll("-debug", ""));
    expect(readme).toInclude("index.ts");
  });

  it.each(filesCreated)("creates %s", file => {
    expect(fs.existsSync(path.join(temp, file))).toBeTrue();
  });
});

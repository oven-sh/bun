import fs from "fs";
import path from "path";
import os from "os";
import { bunExe, bunEnv } from "harness";

test("bun init works", () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bun-init-X")));

  const out = Bun.spawnSync({
    cmd: [bunExe(), "init", "-y"],
    cwd: temp,
    stdio: ["ignore", "inherit", "inherit"],
    env: bunEnv,
  });

  expect(out.signal).toBe(undefined);
  expect(out.exitCode).toBe(0);

  const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
  expect(pkg).toEqual({
    "name": path.basename(temp).toLowerCase(),
    "module": "index.ts",
    "type": "module",
    "devDependencies": {
      "@types/bun": "latest",
    },
    "peerDependencies": {
      "typescript": "^5.0.0",
    },
  });
  const readme = fs.readFileSync(path.join(temp, "README.md"), "utf8");
  expect(readme).toStartWith("# " + path.basename(temp).toLowerCase() + "\n");
  expect(readme).toInclude("v" + Bun.version.replaceAll("-debug", ""));
  expect(readme).toInclude("index.ts");

  expect(fs.existsSync(path.join(temp, "index.ts"))).toBe(true);
  expect(fs.existsSync(path.join(temp, ".gitignore"))).toBe(true);
  expect(fs.existsSync(path.join(temp, "node_modules"))).toBe(true);
  expect(fs.existsSync(path.join(temp, "tsconfig.json"))).toBe(true);
}, 30_000);

test("bun init with piped cli", () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bun-init-X")));

  const out = Bun.spawnSync({
    cmd: [bunExe(), "init"],
    cwd: temp,
    stdio: [new Blob(["\n\n\n\n\n\n\n\n\n\n\n\n"]), "inherit", "inherit"],
    env: bunEnv,
  });

  expect(out.signal).toBe(undefined);
  expect(out.exitCode).toBe(0);

  const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
  expect(pkg).toEqual({
    "name": path.basename(temp).toLowerCase(),
    "module": "index.ts",
    "type": "module",
    "devDependencies": {
      "@types/bun": "latest",
    },
    "peerDependencies": {
      "typescript": "^5.0.0",
    },
  });
  const readme = fs.readFileSync(path.join(temp, "README.md"), "utf8");
  expect(readme).toStartWith("# " + path.basename(temp).toLowerCase() + "\n");
  expect(readme).toInclude("v" + Bun.version.replaceAll("-debug", ""));
  expect(readme).toInclude("index.ts");

  expect(fs.existsSync(path.join(temp, "index.ts"))).toBe(true);
  expect(fs.existsSync(path.join(temp, ".gitignore"))).toBe(true);
  expect(fs.existsSync(path.join(temp, "node_modules"))).toBe(true);
  expect(fs.existsSync(path.join(temp, "tsconfig.json"))).toBe(true);
}, 30_000);

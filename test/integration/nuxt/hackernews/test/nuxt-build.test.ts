import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "fs";
import { cp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { bunEnv, bunExe } from "../../../../harness";

const root = join(import.meta.dir, "../");

let build_passed = false;

async function tempDirToBuildIn() {
  const dir = mkdtempSync(join(tmpdir(), "bun-nuxt-build-"));
  const copy = [
    ".eslintrc",
    "app.vue",
    "bun.lockb",
    "nuxt.config.ts",
    "package.json",
    "types.ts",
    "components",
    "composables",
    "layouts",
    "middleware",
    "pages",
    "public",
    "server",
  ];
  await Promise.all(copy.map(x => cp(join(root, x), join(dir, x), { recursive: true })));
  // REVIEW idk why this is here
  // cpSync(join(root, "components/Counter1.txt"), join(dir, "components/CounterComponent.vue"));
  cpSync(join(root, "tsconfig_for_build.json"), join(dir, "tsconfig.json"));
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
  return dir;
}

function readdirRecursive(dir: string) {
  let results: string[] = [];

  readdirSync(dir, { withFileTypes: true }).forEach(file => {
    if (file.isDirectory()) {
      results = results.concat(readdirRecursive(join(dir, file.name)).map(x => join(file.name, x)));
    } else {
      results.push(file.name);
    }
  });

  return results;
}

function hashAllFiles(dir: string) {
  const files = readdirRecursive(dir).sort();
  const hashes: Record<string, string> = {};
  for (const file of files) {
    const hash = new Bun.CryptoHasher("sha256");
    hash.update(readFileSync(join(dir, file)));
    hashes[file] = hash.digest("hex");
  }
  return hashes;
}

test("nuxt build works", async () => {
  // REVIEW idk why this is here
  // copyFileSync(join(root, "components/Counter1.txt"), join(root, "components/CounterComponent.vue"));

  const install = Bun.spawnSync([bunExe(), "i"], { cwd: root, env: bunEnv });
  if (install.exitCode !== 0) {
    throw new Error("Failed to install dependencies");
  }

  const bunDir = await tempDirToBuildIn();
  const nodeDir = await tempDirToBuildIn();

  const bunBuild = await Bun.spawn([bunExe(), "--bun", "node_modules/.bin/nuxi", "build"], {
    cwd: bunDir,
    // env: bunEnv,
    stdio: ["ignore", "pipe", "inherit"],
    env: {
      ...bunEnv,
      NODE_ENV: "production",
    },
  });
  const nodeBuild = await Bun.spawn(["node", "node_modules/.bin/nuxi", "build"], {
    cwd: nodeDir,
    env: bunEnv,
    stdio: ["ignore", "pipe", "inherit"],
  });
  await Promise.all([bunBuild.exited, nodeBuild.exited]);
  expect(nodeBuild.exitCode).toBe(0);
  expect(bunBuild.exitCode).toBe(0);

  const bunCliOutputRaw = await Bun.readableStreamToText(bunBuild.stdout);
  const nodeCliOutputRaw = await Bun.readableStreamToText(nodeBuild.stdout);

  // Normalize Nuxt version, remove file hashes, and ignore minor size discrepancies
  const normalizeOutput = (text: string) =>
    text
      .replace(/Nuxt \d+\.\d+\.\d+/g, "Nuxt [version]")
      .replace(/_[a-z0-9]+\.mjs/g, "_.mjs") // Normalize MJS file hashes
      .replace(/_[a-z0-9]+\.js/g, "_.js") // Normalize JS file hashes
      .replace(/\d+\.\d+ kB/g, "X.XX kB") // Normalize minor size discrepancies
      .replace(/\d+\.\d+ MB/g, "X.XX MB") // Normalize MB size discrepancies
      .replace(/\d+\.\d+s/g, "X.XXs") // Normalize build duration
      .replace(/\d+ B gzip/g, "XXX B gzip") // Normalize exact byte sizes for gzip
      .replace(/\d+ kB gzip/g, "XXX kB gzip") // Normalize exact kilobyte sizes for gzip
      .replace(/\d+ B/g, "XXX B"); // Normalize exact byte sizes

  const bunCliOutput = normalizeOutput(bunCliOutputRaw);
  const nodeCliOutput = normalizeOutput(nodeCliOutputRaw);

  expect(bunCliOutput).toBe(nodeCliOutput);

  const bunBuildDir = join(bunDir, ".nuxt");
  const nodeBuildDir = join(nodeDir, ".nuxt");

  const toRemove = ["dist/client/_nuxt", "dist/server/_nuxt"];
  for (const key of toRemove) {
    rmSync(join(bunBuildDir, key), { recursive: true });
    rmSync(join(nodeBuildDir, key), { recursive: true });
  }

  const bunBuildHash = hashAllFiles(bunBuildDir);
  const nodeBuildHash = hashAllFiles(nodeBuildDir);

  try {
    expect(bunBuildHash).toEqual(nodeBuildHash);
  } catch (error) {
    console.log("bunBuildDir", bunBuildDir);
    console.log("nodeBuildDir", nodeBuildDir);

    // print diffs for every file if not the same
    for (const key in bunBuildHash) {
      if (bunBuildHash[key] !== nodeBuildHash[key]) {
        console.log(key + ":");
        try {
          expect(readFileSync(join(bunBuildDir, key)).toString()).toBe(
            readFileSync(join(nodeBuildDir, key)).toString(),
          );
        } catch (error) {
          console.error(error);
        }
      }
    }
    throw error;
  }

  build_passed = true;
}, 300000);

const version_string = "[production needs a constant string]";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "../../../../harness";
import { copyFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { cp } from "fs/promises";

const root = join(import.meta.dir, "../");

let build_passed = false;

async function tempDirToBuildIn() {
  const dir = mkdtempSync(join(tmpdir(), "bun-next-build-"));
  const copy = [
    ".eslintrc.json",
    "bun.lockb",
    "next.config.js",
    "next.config.js",
    "package.json",
    "postcss.config.js",
    "public",
    "src",
    "tailwind.config.ts",
  ];
  await Promise.all(copy.map(x => cp(join(root, x), join(dir, x), { recursive: true })));
  cpSync(join(root, "src/Counter1.txt"), join(dir, "src/Counter.tsx"));
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

test("next build works", async () => {
  copyFileSync(join(root, "src/Counter1.txt"), join(root, "src/Counter.tsx"));

  const install = Bun.spawnSync([bunExe(), "i"], { cwd: root, env: bunEnv });
  if (install.exitCode !== 0) {
    throw new Error("Failed to install dependencies");
  }

  const bunDir = await tempDirToBuildIn();
  const nodeDir = await tempDirToBuildIn();

  const bunBuild = await Bun.spawn([bunExe(), "--bun", "node_modules/.bin/next", "build"], {
    cwd: bunDir,
    // env: bunEnv,
    stdio: ["ignore", "pipe", "inherit"],
    env: {
      ...bunEnv,
      NODE_ENV: "production",
    },
  });
  const nodeBuild = await Bun.spawn(["node", "node_modules/.bin/next", "build"], {
    cwd: nodeDir,
    env: bunEnv,
    stdio: ["ignore", "pipe", "inherit"],
  });
  await Promise.all([bunBuild.exited, nodeBuild.exited]);
  expect(nodeBuild.exitCode).toBe(0);
  expect(bunBuild.exitCode).toBe(0);

  // remove timestamps from output
  const bunCliOutput = (await Bun.readableStreamToText(bunBuild.stdout)).replace(/\(\d+(?:\.\d+)? m?s\)/gi, "");
  const nodeCliOutput = (await Bun.readableStreamToText(nodeBuild.stdout)).replace(/\(\d+(?:\.\d+)? m?s\)/gi, "");

  expect(bunCliOutput).toBe(nodeCliOutput);

  const bunBuildDir = join(bunDir, ".next");
  const nodeBuildDir = join(nodeDir, ".next");

  const toRemove = [
    // these have timestamps and absolute paths in them
    "trace",
    "cache",
    "required-server-files.json",
    // these have "signing keys", not sure what they are tbh
    "prerender-manifest.json",
    "prerender-manifest.js",
    // these are similar but i feel like there might be something we can fix to make them the same
    "next-minimal-server.js.nft.json",
    "next-server.js.nft.json",
    // not sorted lol
    "server/pages-manifest.json",
  ];
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

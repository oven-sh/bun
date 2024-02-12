// @known-failing-on-windows: 1 failing
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "../../../../harness";
import { copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, promises as fs } from "fs";
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

async function hashAllFiles(dir: string) {
  console.log("Hashing");
  const files = (await fs.readdir(dir, { recursive: true, withFileTypes: true })).sort();
  const hashes: Record<string, string> = {};
  const promises = new Array(files.length);
  for (let i = 0; i < promises.length; i++) {
    if (!(files[i].isFile() || files[i].isSymbolicLink())) {
      i--;
      promises.length--;
      continue;
    }

    promises[i] = (async function (file, path) {
      try {
        const contents = await fs.readFile(path);
        hashes[file] = Bun.CryptoHasher.hash("sha256", contents, "hex");
      } catch (error) {
        console.error("error", error, "in", path);
        throw error;
      }
    })(files[i].name, join(dir, files[i].name));
  }
  await Promise.all(promises);
  return hashes;
}

test("next build works", async () => {
  copyFileSync(join(root, "src/Counter1.txt"), join(root, "src/Counter.tsx"));

  const install = Bun.spawn([bunExe(), "i"], {
    cwd: root,
    env: bunEnv,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await install.exited) !== 0) {
    throw new Error("Failed to install dependencies");
  }

  console.log("Starting build...");

  const bunDir = await tempDirToBuildIn();
  const nodeDir = await tempDirToBuildIn();

  console.time("[bun] next build");
  const bunBuild = Bun.spawn([bunExe(), "--bun", "node_modules/.bin/next", "build"], {
    cwd: bunDir,
    // env: bunEnv,
    stdio: ["ignore", "pipe", "inherit"],
    env: {
      ...bunEnv,
      NODE_ENV: "production",
    },
  });

  console.time("[node] next build");
  const nodeBuild = Bun.spawn(["node", "node_modules/.bin/next", "build"], {
    cwd: nodeDir,
    env: { ...bunEnv, NODE_NO_WARNINGS: "1", NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await Promise.all([
    bunBuild.exited.then(a => {
      console.timeEnd("[bun] next build");
      return a;
    }),
    nodeBuild.exited.then(a => {
      console.timeEnd("[node] next build");
      return a;
    }),
  ]);
  expect(nodeBuild.exitCode).toBe(0);
  expect(bunBuild.exitCode).toBe(0);

  const bunCliOutput = (await new Response(bunBuild.stdout).text())
    // remove timestamps from output
    .replace(/\(\d+(?:\.\d+)? m?s\)/gi, "");
  // normalize displayed bytes (round down to 0)
  // .replace(/\d(?:\.\d+)?(?= k?B)/g, "0")
  // normalize multiple spaces to single spaces (must perform last)
  // .replace(/\s{2,}/g, " ");
  const nodeCliOutput = (await new Response(nodeBuild.stdout).text())
    // remove timestamps from output
    .replace(/\(\d+(?:\.\d+)? m?s\)/gi, "");
  // normalize displayed bytes (round down to 0)
  // .replace(/\d(?:\.\d+)?(?= k?B)/g, "0")
  // normalize multiple spaces to single spaces (must perform last)
  // .replace(/\s{2,}/g, " ");

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

  console.log("Hashing files...");
  const [bunBuildHash, nodeBuildHash] = await Promise.all([hashAllFiles(bunBuildDir), hashAllFiles(nodeBuildDir)]);

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
}, 600000);

const version_string = "[production needs a constant string]";

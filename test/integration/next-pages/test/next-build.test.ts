import { install_test_helpers } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { copyFileSync, cpSync, promises as fs, readFileSync, rmSync } from "fs";
import { cp } from "fs/promises";
import { join } from "path";
import { bunEnv, bunExe, isDebug, tmpdirSync, toMatchNodeModulesAt } from "../../../harness";
const { parseLockfile } = install_test_helpers;

expect.extend({ toMatchNodeModulesAt });

const root = join(import.meta.dir, "../");

async function tempDirToBuildIn() {
  const dir = tmpdirSync(
    "next-" + Math.ceil(performance.now() * 1000).toString(36) + Math.random().toString(36).substring(2, 8),
  );
  console.log("Temp dir: " + dir);
  const copy = [
    ".eslintrc.json",
    "bun.lock",
    "next.config.js",
    "package.json",
    "postcss.config.js",
    "public",
    "src",
    "tailwind.config.ts",
    "bunfig.toml",
  ];
  await Promise.all(copy.map(x => cp(join(root, x), join(dir, x), { recursive: true })));
  cpSync(join(root, "src/Counter1.txt"), join(dir, "src/Counter.tsx"));
  cpSync(join(root, "tsconfig_for_build.json"), join(dir, "tsconfig.json"));

  const install = Bun.spawnSync([bunExe(), "i"], {
    cwd: dir,
    env: bunEnv,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!install.success) {
    const reason = install.signalCode || `code ${install.exitCode}`;
    throw new Error(`Failed to install dependencies: ${reason}`);
  }

  return dir;
}

async function hashFile(file: string, path: string, hashes: Record<string, string>) {
  try {
    const contents = await fs.readFile(path);
    hashes[file] = Bun.CryptoHasher.hash("sha256", contents, "hex");
  } catch (error) {
    console.error("error", error, "in", path);
    throw error;
  }
}

async function hashAllFiles(dir: string) {
  console.time("Hashing");
  try {
    const files = (await fs.readdir(dir, { recursive: true, withFileTypes: true }))
      .filter(x => x.isFile() || x.isSymbolicLink())
      .sort((a, b) => {
        return a.name.localeCompare(b.name);
      });

    const hashes: Record<string, string> = {};
    const batchSize = 4;

    while (files.length > 0) {
      const batch = files.splice(0, batchSize);
      await Promise.all(batch.map(file => hashFile(file.name, join(file.parentPath, file.name), hashes)));
    }

    return hashes;
  } finally {
    console.timeEnd("Hashing");
  }
}

function normalizeOutput(stdout: string) {
  return (
    stdout
      // remove timestamps from output
      .replace(/\(\d+(?:\.\d+)? m?s\)/gi, data => " ".repeat(data.length))
      // displayed file sizes are in post-gzip compression, however
      // the gzip / node:zlib implementation is different in bun and node
      .replace(/\d+(\.\d+)? [km]?b/gi, data => " ".repeat(data.length))

      .split("\n")
      .map(x => x.trim())
      .join("\n")
  );
}

test(
  "next build works",
  async () => {
    rmSync(join(root, ".next"), { recursive: true, force: true });
    copyFileSync(join(root, "src/Counter1.txt"), join(root, "src/Counter.tsx"));

    const bunDir = await tempDirToBuildIn();
    let lockfile = parseLockfile(bunDir);
    expect(lockfile).toMatchNodeModulesAt(bunDir);
    expect(parseLockfile(bunDir)).toMatchSnapshot("bun");

    const nodeDir = await tempDirToBuildIn();
    lockfile = parseLockfile(nodeDir);
    expect(lockfile).toMatchNodeModulesAt(nodeDir);
    expect(lockfile).toMatchSnapshot("node");

    console.log("Bun Dir: " + bunDir);
    console.log("Node Dir: " + nodeDir);

    const nextPath = "node_modules/next/dist/bin/next";
    const tmp1 = tmpdirSync();
    console.time("[bun] next build");
    const bunBuild = Bun.spawn([bunExe(), "--bun", nextPath, "build"], {
      cwd: bunDir,
      stdio: ["ignore", "pipe", "inherit"],
      env: {
        ...bunEnv,
        NODE_NO_WARNINGS: "1",
        NODE_ENV: "production",
        TMPDIR: tmp1,
        TEMP: tmp1,
        TMP: tmp1,
      },
    });

    const tmp2 = tmpdirSync();
    console.time("[node] next build");
    const nodeBuild = Bun.spawn(["node", nextPath, "build"], {
      cwd: nodeDir,
      env: {
        ...bunEnv,
        NODE_NO_WARNINGS: "1",
        NODE_ENV: "production",
        TMPDIR: tmp2,
        TEMP: tmp2,
        TMP: tmp2,
      },
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

    const bunCliOutput = normalizeOutput(await new Response(bunBuild.stdout).text());
    const nodeCliOutput = normalizeOutput(await new Response(nodeBuild.stdout).text());

    console.log("bun", bunCliOutput);
    console.log("node", nodeCliOutput);

    expect(bunCliOutput).toBe(nodeCliOutput);

    const bunBuildDir = join(bunDir, ".next");
    const nodeBuildDir = join(nodeDir, ".next");

    // Remove some build files that Next.js does not make deterministic.
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
      // this file is not deterministically sorted
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
  },
  isDebug ? Infinity : 60_0000,
);

import { expect, test } from "bun:test";
import { copyFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "fs";
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
  cpSync(join(root, "components/Counter1.txt"), join(dir, "components/CounterComponent.vue"));
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
  copyFileSync(join(root, "components/Counter1.txt"), join(root, "components/CounterComponent.vue"));

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
      .replace(/_[a-z0-9]+\.mjs/g, "_.mjs") // Normalize MJS file hashes
      .replace(/_[a-z0-9]+\.js/g, "_.js") // Normalize JS file hashes
      .replace(/\d+\.\d+ kB/g, "X.XX kB") // Normalize minor size discrepancies
      .replace(/\d+\.\d+ MB/g, "X.XX MB") // Normalize MB size discrepancies
      .replace(/\d+\.\d+s/g, "X.XXs") // Normalize build duration
      .replace(/\d+ B gzip/g, "XXX B gzip") // Normalize exact byte sizes for gzip
      .replace(/\d+ kB gzip/g, "XXX kB gzip") // Normalize exact kilobyte sizes for gzip
      .replace(/\d+ B/g, "XXX B") // Normalize exact byte sizes
      .replace(/(\.output\/server\/chunks\/app\/_nuxt\/[a-z]+)-[a-z0-9]+(\.mjs)/g, "$1-HASH$2")
      .replace(/(\.nuxt\/dist\/server\/_nuxt\/_[a-z]+-styles-\d)\.mjs-[a-z0-9]+(\.js)/g, "$1.mjs-HASH$2")
      .replace(/(\.nuxt\/dist\/server\/_nuxt\/_id_-)[a-z0-9]+(\.js)/g, "$1HASH$2")
      .replace(/(\.output\/server\/chunks\/app\/_nuxt\/error-404)-[a-z0-9]+(\.mjs)/g, "$1-HASH$2")
      .replace(/(_nuxt\/[a-z]+)-[a-z0-9]+(\.mjs\.map)/g, "_nuxt/$1.HASH$2")
      .replace(/(_nuxt\/[a-z]+)-[a-z0-9]+(\.js)/g, "_nuxt/$1.HASH$2")
      .replace(/(_nuxt\/_)-[a-z0-9]+(\.mjs)/g, "_nuxt/_HASH$2")
      .replace(/(\.output\/server\/chunks\/app\/_nuxt\/[a-z0-9_-]+)\.[a-z0-9]+(\.mjs\.map)/g, "$1.HASH$2")
      .replace(/(\.nuxt\/dist\/server\/_nuxt\/[a-z0-9_-]+)\.[a-z0-9]+(\.js)/g, "$1.HASH$2")
      .replace(/(\.output\/server\/chunks\/app\/_nuxt\/_)[a-z0-9_-]+(\.mjs)/g, "$1HASH$2")
      .replace(/(\.output\/server\/chunks\/app\/_nuxt\/[a-z0-9_-]+)\.[a-z0-9]+(\.mjs\.map)/g, "$1.HASH$2")
      .replace(/(\.nuxt\/dist\/server\/_nuxt\/[a-z0-9_-]+)\.[a-z0-9]+(\.js)/g, "$1.HASH$2")
      .replace(/(\.output\/server\/chunks\/app\/_nuxt\/_id_-)[a-z0-9]+(\.mjs)/g, "$1HASH$2")
      // Enhanced regex for specific hash normalization in .nuxt/dist
      .replace(/(\.nuxt\/dist\/(?:client|server)\/_nuxt\/[a-z0-9_-]+)\.[a-z0-9]+(\.js|\.mjs)/g, "$1.HASH$2")
      // New regex for specific hash normalization in .output/server/chunks/app/_nuxt
      .replace(/(\.output\/server\/chunks\/app\/_nuxt\/[a-z0-9_-]+)\.[a-z0-9]+(\.mjs(\.map)?)/g, "$1.HASH$2")
      .replace(/(\.output\/server\/chunks\/app\/_nuxt\/_id_-)[a-z0-9]+(\.mjs\.map)/g, "$1HASH$2")
      .replace(/_[a-z0-9]+\.(mjs|css)/g, "_.$1") // Normalize file hashes for .mjs and .css
      .replace(/\d+(\.\d+)?(s|ms|kB|MB)/g, "X.XX$2") // Normalize time & size measurements, including integers and decimals
      .replace(/\d+ B (gzip)?/g, "XXX B $1") // Normalize byte sizes, including gzip
      .replace(/\/bun-nuxt-build-[a-zA-Z0-9]+\//g, "/bun-nuxt-build-XXXXXX/") // Normalize dynamic paths in build output
      .replace(/gzip:\s+\d+\.\d+\s+kB/g, "gzip: XXX kB") // More flexible normalization for gzip sizes
      .replace(/(_[a-z0-9]+\.)[a-z0-9]+(\.mjs|\.js|\.css)/g, "$1HASH$2"); // Regex pattern to match hashes (e.g., _id_.5b600b5a, store.4c25e934)

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
}, 300_000);

const version_string = "[production needs a constant string]";

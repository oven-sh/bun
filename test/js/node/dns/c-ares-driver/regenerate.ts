// Writes the logs of c-ares in ../dns-simulation-c-ares.txt again. Linux only: it needs clang, llvm-objcopy or objcopy, and
// a checkout of https://github.com/c-ares/c-ares at 1.34.9.
//
//   bun test/js/node/dns/c-ares-driver/regenerate.ts path/to/c-ares
import { $ } from "bun";
import { tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { marked, path, read } from "./golden";

const COMMIT = "bc91829cce983a35ec01f5dbc05465858a3df469";

const [source] = process.argv.slice(2);
if (!source) throw new Error("usage: regenerate.ts path/to/c-ares");
const head = (await $`git -C ${source} rev-parse HEAD`.text()).trim();
if (head !== COMMIT) throw new Error(`${source} is at ${head}, not at ${COMMIT}`);
const lib = resolve(source, "src/lib");
const here = import.meta.dir;
const objcopy = Bun.which("llvm-objcopy") ?? Bun.which("objcopy");
if (!objcopy) throw new Error("objcopy is not installed");

const flags = [
  ...["-g", "-O1", "-U_FORTIFY_SOURCE", "-D_FORTIFY_SOURCE=0", "-Wno-deprecated-declarations"],
  ...["-DHAVE_CONFIG_H=1", "-DCARES_BUILDING_LIBRARY", "-D_GNU_SOURCE"],
  ...[here, resolve(source, "include"), lib, join(lib, "include")].map(directory => `-I${directory}`),
];

using directory = tempDir("c-ares-driver", {});
const build = String(directory);
const objects = await Promise.all(
  [...new Bun.Glob("**/*.c").scanSync(lib)]
    // The driver has random numbers of its own.
    .filter(file => file !== "util/ares_rand.c")
    .map(async file => {
      const object = join(build, file.replaceAll("/", "_") + ".o");
      await $`clang ${flags} -D_POSIX_C_SOURCE=200809 -D_XOPEN_SOURCE=700 -c ${join(lib, file)} -o ${object}`;
      await $`${objcopy} --redefine-syms=${join(here, "renamed-symbols.txt")} ${object}`;
      if (file === "dsa/ares_slist.c")
        await $`${objcopy} --redefine-sym ares_rand_bytes=sim_slist_rand_bytes ${object}`;
      return object;
    }),
);
const driver = join(build, "driver");
await $`clang ${flags} ${join(here, "driver.c")} ${objects} -lpthread -o ${driver}`;

const { preamble, entries } = read();
const written = entries.map(({ title, script, ours }) => {
  const { stdout, exitCode } = Bun.spawnSync([driver], { stdin: Buffer.from(marked(script)) });
  if (exitCode !== 0) throw new Error(`the driver failed on ${title}`);
  return `=== ${title}\n${script}---\n${stdout}${ours === undefined ? "" : `+++\n${ours}`}`;
});
writeFileSync(path, preamble + written.join(""));

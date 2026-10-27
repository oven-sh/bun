// Writes the logs of c-ares in ../dns-simulation-c-ares.txt again. Linux only: it needs clang, llvm-objcopy or objcopy, and
// a checkout of https://github.com/c-ares/c-ares at bc91829cce983a35ec01f5dbc05465858a3df469 (1.34.9).
//
//   bun test/js/node/dns/c-ares-driver/regenerate.ts path/to/c-ares
import { $ } from "bun";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [source] = process.argv.slice(2);
if (!source) throw new Error("usage: regenerate.ts path/to/c-ares");
const lib = resolve(source, "src/lib");
const here = import.meta.dir;
const objcopy = Bun.which("llvm-objcopy") ?? Bun.which("objcopy");
if (!objcopy) throw new Error("objcopy is not installed");

const flags = [
  ...["-g", "-O1", "-U_FORTIFY_SOURCE", "-D_FORTIFY_SOURCE=0", "-Wno-deprecated-declarations"],
  ...["-DHAVE_CONFIG_H=1", "-DCARES_BUILDING_LIBRARY", "-D_GNU_SOURCE"],
  ...[here, resolve(source, "include"), lib, join(lib, "include")].map(directory => `-I${directory}`),
];

const build = mkdtempSync(join(tmpdir(), "c-ares-driver-"));
try {
  const objects = await Promise.all(
    readFileSync(join(here, "sources.txt"), "utf8")
      .split("\n")
      .filter(name => name !== "")
      .map(async name => {
        const object = join(build, name.replaceAll("/", "_") + ".o");
        await $`clang ${flags} -D_POSIX_C_SOURCE=200809 -D_XOPEN_SOURCE=700 -c ${join(lib, name + ".c")} -o ${object}`;
        await $`${objcopy} --redefine-syms=${join(here, "renamed-symbols.txt")} ${object}`;
        if (name === "dsa/ares_slist")
          await $`${objcopy} --redefine-sym ares_rand_bytes=sim_slist_rand_bytes ${object}`;
        return object;
      }),
  );
  const driver = join(build, "driver");
  await $`clang ${flags} ${join(here, "driver.c")} ${objects} -lpthread -o ${driver}`;

  const path = join(here, "../dns-simulation-c-ares.txt");
  const entries = readFileSync(path, "utf8")
    .split(/^=== /m)
    .slice(1)
    .map(entry => {
      const [head, logs] = entry.split(/^---\n/m);
      const [, ours] = logs.split(/^\+\+\+\n/m);
      // As the test marks a script.
      const lines = head.split("\n").slice(1);
      const script = lines.filter(line => line !== "").flatMap(line => [line, "@"]).join("\n") + "\n"; // prettier-ignore
      const { stdout, exitCode } = Bun.spawnSync([driver], { stdin: Buffer.from(script) });
      if (exitCode !== 0) throw new Error(`the driver failed on ${head}`);
      return `=== ${head}---\n${stdout}${ours === undefined ? "" : `+++\n${ours}`}`;
    });
  writeFileSync(path, entries.join(""));
} finally {
  rmSync(build, { recursive: true, force: true });
}

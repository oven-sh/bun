import { $, semver } from "bun";
import { test } from "bun:test";
import { bunExe } from "harness";

const BUN_EXE = bunExe();

if (process.platform === "linux") {
  test("objdump -T does not include symbols from glibc > 2.26", async () => {
    const objdump = Bun.which("objdump") || Bun.which("llvm-objdump");
    if (!objdump) {
      throw new Error("objdump executable not found. Please install it.");
    }

    const output = await $`${objdump} -T ${BUN_EXE} | grep GLIBC_`.nothrow().text();
    const lines = output.split("\n");
    const errors = [];
    for (const line of lines) {
      const match = line.match(/\(GLIBC_2(.*)\)\s/);
      if (match?.[1]) {
        let version = "2." + match[1];
        if (version.startsWith("2..")) {
          version = "2." + version.slice(3);
        }
        if (semver.order(version, "2.26.0") > 0) {
          errors.push({
            symbol: line.slice(line.lastIndexOf(")") + 1).trim(),
            "glibc version": version,
          });
        }
      }
    }
    if (errors.length) {
      throw new Error(`Found glibc symbols > 2.26. This breaks Amazon Linux 2 and Vercel.

${Bun.inspect.table(errors, { colors: true })}
To fix this, add it to -Wl,-wrap=symbol in the linker flags and update workaround-missing-symbols.cpp.`);
    }
  });

  test("libatomic.so is not linked", async () => {
    const ldd = Bun.which("ldd");

    if (!ldd) {
      throw new Error("ldd executable not found. Please install it.");
    }

    const output = await $`${ldd} ${BUN_EXE}`.text();
    const lines = output.split("\n");
    const errors = [];
    for (const line of lines) {
      // libatomic
      if (line.includes("libatomic")) {
        errors.push(line);
      }
    }
    if (errors.length) {
      throw new Error(`libatomic.so is linked. This breaks Amazon Linux 2 and Vercel.

${errors.join("\n")}

To fix this, figure out which C math symbol is being used that causes it, and wrap it in workaround-missing-symbols.cpp.`);
    }
  });
}

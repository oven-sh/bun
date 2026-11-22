// Temporary: what holds a function of parallel/gc/function-objects-named-program-collected.mjs on Windows arm64.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { test } from "./supported";

const program = readFileSync(join(import.meta.dir, "parallel/gc/function-objects-named-program-collected.mjs"), "utf8");
const last = "console.log(watched.map(";
const withDiag = (text: string) => `import { capture, report, takeSnapshot } from "./diag.mjs";\n` + text;
const captured = program.replace("  Bun.gc(true);\n", "  Bun.gc(true);\n  capture();\n");
const variants: Record<string, string> = {
  plain: program,
  capture: withDiag(captured) + "report(watched);\n",
  snapshot: withDiag(captured.replace(last, "takeSnapshot();\n" + last)) + "report(watched);\n",
  late: program.replace(last, `const { report } = await import("./diag.mjs");\n` + last) + "report(watched);\n",
  lateSnapshot:
    program.replace(last, `const { report, takeSnapshot } = await import("./diag.mjs");\ntakeSnapshot();\n` + last) +
    "report(watched);\n",
  control:
    withDiag(
      captured
        .replace("watched.push(new WeakRef(made));", "watched.push(new WeakRef(made)); globalThis.kept ??= [made];")
        .replace("  capture();", "  globalThis.kept.forEach(() => capture());"),
    ) + "report(watched);\n",
};

test.skipIf(!(isWindows && process.arch === "arm64") && !process.env.ZZ_DIAGNOSE)(
  "what holds it",
  async () => {
    using dir = tempDir("zz-diagnose", {
      "diag.mjs": readFileSync(join(import.meta.dir, "zz-diagnose/diag.mjs"), "utf8"),
      ...Object.fromEntries(Object.entries(variants).map(([name, text]) => [name + ".mjs", text])),
    });
    const { BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: _, BUN_GARBAGE_COLLECTOR_LEVEL: __, ...env } = bunEnv;
    const out: string[] = [];
    const folder = dirname(bunExe());
    const inArchive = basename(folder) + "/bun-profile.map";
    if (isWindows) Bun.spawnSync(["tar", "-xf", folder + ".zip", inArchive], { cwd: String(dir), stderr: "inherit" });
    const map = join(String(dir), inArchive);
    const image = readFileSync(bunExe());
    const dumped = new Set<string>();
    const codeAround = (rva: number) => {
      const name = nameOf(rva);
      if (!name) return;
      const start = rva - parseInt(name.slice(name.lastIndexOf("+0x") + 3), 16);
      const table = image.readUInt32LE(0x3c) + 24 + image.readUInt16LE(image.readUInt32LE(0x3c) + 20);
      const delta = image.readUInt32LE(table + 20) - image.readUInt32LE(table + 12);
      const key = name.slice(0, name.lastIndexOf("+0x"));
      if (dumped.has(key)) return;
      dumped.add(key);
      const end = symbols.find(([at]) => at > start)![0];
      out.push(
        `CODE ${key} ${start.toString(16)} ${image.subarray(start + delta, Math.min(end, start + 24000) + delta).toString("hex")}`,
      );
    };
    const symbols: [number, string][] = [];
    if (existsSync(map))
      for (const [, name, address] of readFileSync(map, "latin1").matchAll(/^ \w{4}:\w{8}\s+(\S+)\s+(\w{16})\s/gm))
        symbols.push([parseInt(address, 16) - 0x140000000, name]);
    symbols.sort((a, b) => a[0] - b[0]);
    const end = symbols.at(-1)?.[0] ?? 0;
    const nameOf = (rva: number) => {
      if (rva < 0x1000 || rva > end) return undefined;
      let [from, to] = [0, symbols.length - 1];
      while (from < to) {
        const middle = (from + to + 1) >> 1;
        if (symbols[middle][0] <= rva) from = middle;
        else to = middle - 1;
      }
      return `${symbols[from][1].slice(0, 110)}+0x${(rva - symbols[from][0]).toString(16)}`;
    };
    const rounds = Number(process.env.ZZ_DIAGNOSE ?? 50);
    for (const name of process.env.ZZ_ONLY?.split(",") ?? Object.keys(variants)) {
      const exe = join(String(dir), name + (isWindows ? ".exe" : ""));
      const built = Bun.spawnSync([bunExe(), "build", "--compile", "--aot", `./${name}.mjs`, "--outfile", exe], {
        cwd: String(dir),
        env,
      });
      if (built.exitCode !== 0) {
        out.push(`${name}: build failed ${built.stderr}`);
        continue;
      }
      const settings: Record<string, string>[] =
        name === "plain"
          ? [
              {},
              { BUN_JSC_useConcurrentGC: "0" },
              { BUN_JSC_numberOfGCMarkers: "1" },
              { BUN_JSC_useGenerationalGC: "0" },
              { BUN_GC_TIMER_DISABLE: "1" },
            ]
          : [{}];
      for (const more of settings) {
        const counts: Record<string, number> = {};
        let shown = 0;
        for (let round = 0; round < (name === "control" ? 1 : rounds); round++) {
          const { stdout, stderr, exitCode } = Bun.spawnSync([exe], { cwd: String(dir), env: { ...env, ...more } });
          const diag = /^DIAG (.*)$/m.exec(stderr.toString())?.[1];
          const key = `${exitCode} ${stdout.toString().trim().split("\n").at(-1)} ${diag ? "" : stderr.toString().slice(0, 300)}`;
          counts[key] = (counts[key] ?? 0) + 1;
          if (!diag || shown++ >= 2) continue;
          const { wasTakenBefore, base, low, high, sp, frames, found, around } = JSON.parse(diag);
          const offset = (address: number) => `top-0x${(high - address).toString(16)}`;
          out.push(
            `--- ${name} round ${round}: sp ${offset(sp)}, copied from ${offset(low)}, snapshot before deref: ${wasTakenBefore}`,
          );
          const marks = found.flatMap(({ cells }: any) =>
            cells.slice(0, 1).flatMap((cell: any) => cell.words.map((word: any) => word.at)),
          );
          let below = 0;
          frames.forEach(({ fp, lr }: any, index: number) => {
            if (
              marks.some(
                (at: number) =>
                  at >= sp - 0x800 && at >= (frames[index - 1]?.fp ?? 0) && at < (frames[index + 2]?.fp ?? high),
              )
            )
              codeAround(lr - base);
          });
          for (const { fp, lr } of frames) {
            for (const at of marks)
              if (at >= below && at < fp)
                out.push(`      * word at ${offset(at)} (fp-0x${(fp - at).toString(16)})${at < sp ? " BELOW SP" : ""}`);
            out.push(
              `   fp ${offset(fp)} returns to ${nameOf(lr - base) ?? "0x" + lr.toString(16) + " rva 0x" + (lr - base).toString(16)}`,
            );
            below = fp;
          }
          for (const at of marks) if (at >= below) out.push(`      * word at ${offset(at)} above the last frame`);
          for (const { name, cells } of found)
            for (const cell of cells)
              out.push(
                `   ${name}: ${cell.name} "${cell.label}" #${cell.id} ${cell.address} ${cell.bytes}B roots[${cell.roots}] from[${cell.from.join(" | ")}] stack[${cell.words.slice(0, 8).map((word: any) => offset(word.at) + "+" + word.into)}] registers[${cell.registers}]`,
              );
          for (const [at, words] of Object.entries<any>(around)) {
            out.push(`   around ${offset(Number(at))}:`);
            for (const [address, value] of words)
              out.push(
                `     ${address === Number(at) ? ">" : " "}${offset(address)} ${value} ${nameOf(parseInt(value, 16) - base) ?? ""}`,
              );
          }
        }
        out.push(`=== ${name} ${JSON.stringify(more)} ${JSON.stringify(counts)}`);
      }
    }
    console.log(out.filter(line => line.startsWith("===")).join("\n"));
    console.log(`symbols ${symbols.length}`);
    for (const part of Buffer.from(Bun.gzipSync(out.join("\n")))
      .toString("base64")
      .match(/.{1,6000}/g)!)
      console.log("GZ " + part);
    expect("diagnosis").toBe("printed above");
  },
  170_000,
);

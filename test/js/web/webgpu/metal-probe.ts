// Temporary: repeats a file in a macOS virtual machine.
import { test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { isParavirtual } from "./driver";

async function output(cmd: string[], timeout = 15_000) {
  try {
    await using proc = Bun.spawn({ cmd, timeout, stderr: "ignore" });
    return await proc.stdout.text();
  } catch (error) {
    return String(error);
  }
}
const print = (title: string, text: string, lines: number) =>
  console.log(
    text
      .split("\n")
      .slice(0, lines)
      .map(line => `PROBE ${title} ${line.slice(0, 190)}`)
      .join("\n"),
  );

let diagnoses = 0;
async function diagnose() {
  if (++diagnoses > 2) return;
  const processes = (await output(["ps", "-axo", "pid,stat,etime,time,command"])).split("\n");
  print("PS", processes.filter(line => /index\.js|MTLCompiler|WindowServer/.test(line)).join("\n"), 40);
  for (const line of processes.filter(line => /index\.js/.test(line)).slice(0, 3)) {
    const sample = await output(["sample", line.trim().split(" ")[0], "1", "10", "-mayDie"]);
    const graph = sample.slice(sample.indexOf("Call graph:"), sample.indexOf("Total number in stack"));
    print("SAMPLE", graph.replaceAll(/\[0x[0-9a-f]+\]|  \+ \d+/g, ""), 70);
  }
  const predicate = `sender CONTAINS[c] "paravirt" OR sender CONTAINS "IOGPU" OR sender == "Metal" OR process == "MTLCompilerService"`;
  const log = await output(["/usr/bin/log", "show", "--style", "compact", "--last", "25s", "--predicate", predicate]);
  const seen = new Set<string>();
  const unique = log.split("\n").filter(line => {
    const key = line.slice(24).replaceAll(/0x[0-9a-f]+|\d+/g, "#");
    return !seen.has(key) && seen.add(key);
  });
  print("LOG", unique.join("\n"), 60);
}

const modes = ["all 20", "memory 20", "all 5", "memory 5"];

export function probeMetal(first: number) {
  const it = test.skipIf(!isParavirtual && !process.env.PROBE);
  let next = first;
  it.each([1, 2])(
    "%d",
    async () => {
      const cache = (await output(["getconf", "DARWIN_USER_CACHE_DIR"])).trim();
      const runs: string[] = [];
      for (const end = performance.now() + Number(process.env.PROBE ?? 55_000); performance.now() < end; next++) {
        const [teardown, concurrency] = modes[next % 4].split(" ");
        const cold = (next >> 2) % 2 === 0;
        let removed = 0;
        if (cold && isParavirtual) {
          for (const name of readdirSync(cache).filter(name => name.startsWith("com.apple.metal"))) {
            rmSync(join(cache, name), { recursive: true, force: true });
            removed++;
          }
        }
        const start = performance.now();
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "test",
            "--timeout=20000",
            "--bail",
            "--max-concurrency=" + concurrency,
            join(import.meta.dir, "webgpu-lifetime.test.ts"),
          ],
          env: { ...bunEnv, PROBE_TEARDOWN: teardown },
          stdout: "ignore",
          stderr: "pipe",
          timeout: 28_000,
        });
        let diagnosis;
        const timer = setTimeout(() => (diagnosis = diagnose()), 13_000);
        const lines = (await proc.stderr.text()).split("\n");
        const seconds = ((performance.now() - start) / 1000).toFixed(1);
        clearTimeout(timer);
        await diagnosis;
        const failures = lines.filter(line => /^(\(fail\)|✗) |^\+.*(Metal|panic|rror|localhost)/.test(line));
        const slowest = lines
          .map(line => line.match(/^\(pass\) (.*) \[([\d.]+)ms\]/))
          .filter(match => match && +match[2] > 5000)
          .map(match => `slow: ${match![1].slice(0, 70)} ${match![2]}`);
        runs.push(
          [`${teardown}${concurrency}${cold ? "cold" + removed : "warm"} ${seconds}`, ...failures, ...slowest]
            .map(line => line.slice(0, 130))
            .join(" / "),
        );
      }
      print("RUN " + hostname().slice(0, 8), runs.join("\n"), 100);
    },
    120_000,
  );

  it(
    "crashes",
    async () => {
      const addresses = [0x55d856b, 0x53a83ef, 0x53df82f, 0x53b0e3f].map(it => "0x" + (it + 2 ** 32).toString(16));
      print("ATOS", await output(["atos", "-o", bunExe(), ...addresses], 40_000), 10);
      const reports = join(homedir(), "Library/Logs/DiagnosticReports");
      let names: string[] = [];
      try {
        names = readdirSync(reports).filter(name => /^(bun|MTL)/.test(name));
      } catch {}
      print("REPORTS", names.join("\n"), 20);
      for (const name of names.slice(0, 3)) {
        const text = readFileSync(join(reports, name), "utf8");
        const { threads, faultingThread, usedImages, exception } = JSON.parse(text.slice(text.indexOf("\n")));
        const frames = threads[faultingThread].frames.map(
          (frame: any) => `${usedImages[frame.imageIndex].name} ${frame.symbol ?? frame.imageOffset}`,
        );
        print("IPS", [name, JSON.stringify(exception), ...frames].join("\n"), 45);
      }
    },
    60_000,
  );
}

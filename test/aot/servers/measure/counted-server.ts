// For ./tests-by-request.ts and ./arrivals-by-request.ts: a server of ../app, built with a flag that makes the executable count, is started twice and sent every route, each answer compared with
// ../answers.ts: a few times, and that many times and `--requests` more. The difference of the counts belongs to the requests alone.
//
//   --bun <bun with --aot> --server koa [--modules <node_modules>] [--routes text,json] [--requests 1000] [--rows 40] [--work <folder>] [-- <more build flags>]
//
// Needs an installed node_modules (`bun install` in ../app), and nothing else: no counter of the processor is read, so a busy machine prints the same.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { apiRoutes, routes as plainRoutes } from "../answers";

/** A line of the file of counts: how often, the counter's name, and for some counters what it saw. */
export type Count = { count: number; name: string; what: string };

export async function countServer(flag: string) {
  const separator = process.argv.indexOf("--");
  const { values } = parseArgs({
    args: process.argv.slice(2, separator < 0 ? undefined : separator),
    options: { bun: { type: "string" }, server: { type: "string" }, modules: { type: "string" }, routes: { type: "string" }, requests: { type: "string", default: "1000" }, rows: { type: "string", default: "40" }, work: { type: "string" } },
  });
  if (!values.bun || !values.server) throw new Error("--bun and --server are needed");
  const routes = (values.server.startsWith("api-") ? apiRoutes : plainRoutes).filter(route => !values.routes || values.routes.split(",").includes(route.name));
  const work = values.work ?? mkdtempSync(join(tmpdir(), "counted-server-"));
  const app = join(work, "app");
  mkdirSync(work, { recursive: true });
  cpSync(join(import.meta.dir, "..", "app"), app, { recursive: true, filter: path => !path.includes("node_modules") });
  symlinkSync(values.modules ?? join(import.meta.dir, "..", "app", "node_modules"), join(app, "node_modules"));
  // The counts are written when the process exits by itself.
  writeFileSync(join(app, "counted.ts"), `import "./${values.server}";\nprocess.on("SIGTERM", () => process.exit(0));\n`);

  const [executable, map] = [join(work, "server"), join(work, "server.map")];
  const build = Bun.spawnSync({
    cmd: [values.bun, "build", "--compile", "--aot", flag, "--target=bun", "--define", 'process.env.NODE_ENV="production"', ...(separator < 0 ? [] : process.argv.slice(separator + 1)), "./counted.ts", "--outfile", executable],
    cwd: app,
    env: { ...process.env, BUN_JSC_aotMapFilePath: map },
    stderr: "pipe",
  });
  if (build.exitCode !== 0) throw new Error(build.stderr.toString());

  async function countsAfter(times: number): Promise<Count[]> {
    const path = join(work, `counts-${times}.txt`);
    const server = Bun.spawn({ cmd: [executable], cwd: app, env: { ...process.env, PORT: "0", NODE_ENV: "production", BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path }, stdout: "pipe", stderr: "ignore" });
    let printed = "";
    let port: string | undefined;
    for await (const chunk of server.stdout.pipeThrough(new TextDecoderStream())) if ((port = /^listening (\d+)$/m.exec((printed += chunk))?.[1])) break;
    if (!port) throw new Error("the server did not listen");
    for (const route of routes) {
      for (let i = 0; i < times; i++) {
        const response = await fetch(`http://127.0.0.1:${port}${route.path}`, { method: route.method, headers: { ...route.headers, ...(route.request ? { "content-type": "application/json" } : {}) }, body: route.request });
        const body = await response.text();
        if (response.status !== (route.status ?? 200) || body !== route.expectedBody) throw new Error(`${route.name}: ${response.status} ${body.slice(0, 200)}`);
      }
    }
    server.kill("SIGTERM");
    await server.exited;
    return readFileSync(path, "utf8")
      .split("\n")
      .map(line => line.split("\t"))
      .filter(fields => fields.length > 1)
      .map(([count, name, what = ""]) => ({ count: Number(count), name, what }));
  }

  const few = 20;
  const requests = Number(values.requests);
  return { title: `${values.server}, ${routes.map(route => route.name).join(" ")}`, short: await countsAfter(few), long: await countsAfter(few + requests), sent: requests * routes.length, rows: Number(values.rows), map, work };
}

/** The largest sums, one line each. */
export function printTable(title: string, entries: Iterable<[key: string, sum: number]>, rows: number) {
  console.log(`\n${title}`);
  const sums = new Map<string, number>();
  for (const [key, sum] of entries) sums.set(key, (sums.get(key) ?? 0) + sum);
  for (const [key, sum] of [...sums].sort((a, b) => b[1] - a[1]).slice(0, rows)) console.log(`${sum.toFixed(1).padStart(9)}  ${key}`);
}

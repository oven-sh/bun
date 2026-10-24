import { mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { run as said } from "../harness/run";

export const programs = {
  hello: `console.log("hello world");`,
  serve: `
    const server = Bun.serve({
      port: Number(process.env.PORT ?? 0),
      async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname === "/json") return Response.json({ tasks: [{ id: 1, title: "one", done: false }], count: 1 });
        if (url.pathname === "/echo" && request.method === "POST") return Response.json(await request.json(), { status: 201 });
        if (url.pathname === "/text") return new Response("hello world");
        return new Response("not found", { status: 404 });
      },
    });
    console.log("listening on " + server.port);
  `,
  tells: `
    import { homedir, tmpdir } from "node:os";
    console.log(
      JSON.stringify({
        argv: process.argv.slice(2),
        execArgv: process.execArgv,
        fromDotEnv: process.env.FROM_DOT_ENV,
        nodeEnv: process.env.NODE_ENV,
        gc: typeof globalThis.gc,
        title: process.title,
        cwd: process.cwd(),
        zone: new Date(0).toString(),
        offset: new Date(0).getTimezoneOffset(),
        number: (1234567.891).toLocaleString(),
        date: new Date(0).toLocaleString(),
        sorted: ["ä", "z", "a"].sort((a, b) => a.localeCompare(b)).join(""),
        upper: "i".toLocaleUpperCase(),
        terminals: [process.stdin.isTTY, process.stdout.isTTY, process.stderr.isTTY],
        columns: process.stdout.columns,
        colors: Bun.enableANSIColors,
        home: homedir(),
        temporary: tmpdir(),
        noDeprecation: process.noDeprecation,
        throwDeprecation: process.throwDeprecation,
      }),
    );
    console.log({ a: { b: { c: { d: { e: 1 } } } } }, [1, "two"], new Map([["k", 1]]));
    console.error("to stderr");
  `,
  throws: `
    function fails(): never {
      throw new RangeError("not caught");
    }
    console.log("before");
    fails();
  `,
  rejects: `
    console.log("before");
    Promise.reject(new TypeError("not handled"));
    setTimeout(() => console.log("after"), 10);
  `,
  warns: `
    process.emitWarning("an old road", "DeprecationWarning", "DEP_OWN");
    process.emitWarning("take care", { type: "OwnWarning", code: "OWN" });
    setTimeout(() => console.log("after"), 10);
  `,
  fetches: `
    for (const url of [process.env.PLAIN_URL!, process.env.SECURE_URL!]) {
      try {
        const answer = await fetch(url, { headers: { "x-own": "1" } });
        console.log(answer.status, await answer.text());
      } catch (error) {
        console.log((error as Error).name, (error as { code?: string }).code, (error as Error).message);
      }
    }
  `,
  reads: `
    let length = 0;
    for await (const chunk of Bun.stdin.stream()) length += chunk.length;
    console.log("read", length);
  `,
};

export type Program = keyof typeof programs;
type Stream = "pipe" | "closed" | "file" | "terminal" | "null";

export type Case = {
  name: string;
  programs?: Program[];
  env?: Record<string, string>;
  args?: string[];
  files?: Record<string, string>;
  build?: string[];
  stdin?: Stream;
  stdout?: Stream;
  stderr?: Stream;
  signal?: NodeJS.Signals;
  numbersMayDiffer?: boolean;
  calledAs?: string;
  ipc?: "json" | "advanced";
};

export type Ran = { stdout: string; stderr: string; exit: string; answers: string; written: string };

const everyProgram = Object.keys(programs) as Program[];
export const programsOf = (it: Case) => it.programs ?? (it.signal ? (["serve"] as Program[]) : everyProgram.filter(program => program !== "reads" && program !== "fetches"));

export class Bench {
  #built = new Map<string, Promise<string>>();
  #servers: Bun.Server<undefined>[] = [];
  #reports = new Map<string, string[]>();
  #building = 0;
  #waitingToBuild: (() => void)[] = [];
  buildsAtOnce = 4;
  trimWithout: string[] = [];
  constructor(
    readonly bun: string,
    readonly folder: string,
    readonly env: Record<string, string | undefined>,
    readonly tls: { cert: string; key: string },
  ) {
    mkdirSync(join(folder, "source"), { recursive: true });
    writeFileSync(join(folder, "source", "tsconfig.json"), JSON.stringify({ compilerOptions: { noImplicitAny: false, typeRoots: [join(import.meta.dir, "..", "..", "..", "packages")], types: ["bun-types"], skipLibCheck: true } }));
    for (const [name, text] of Object.entries(programs)) writeFileSync(join(folder, "source", name + ".ts"), text);
  }

  executable(program: Program, how: "whole" | "trimmed", flags: string[] = []): Promise<string> {
    const key = [program, how, ...flags].join(" ");
    let built = this.#built.get(key);
    if (!built) {
      const outfile = join(this.folder, "built", String(this.#built.size), how, "app");
      mkdirSync(dirname(outfile), { recursive: true });
      const trim = how === "trimmed" ? ["--trim", ...(this.trimWithout.length > 0 ? ["--trim-without=" + this.trimWithout.join(",")] : [])] : [];
      built = (async () => {
        if (this.#building >= this.buildsAtOnce) await new Promise<void>(resolve => this.#waitingToBuild.push(resolve));
        else this.#building++;
        try {
          const build = await said([this.bun, "build", "--compile", "--aot", ...trim, ...flags, program + ".ts", "--outfile", outfile], join(this.folder, "source"), this.env);
          if (build.exitCode !== 0) throw new Error(`${key}: the build failed: ${build.stderr}`);
          return outfile;
        } finally {
          const next = this.#waitingToBuild.shift();
          if (next) next();
          else this.#building--;
        }
      })();
      this.#built.set(key, built);
    }
    return built;
  }

  servers() {
    if (this.#servers.length === 0) {
      const fetch = (request: Request) => {
        const [, run, report] = /^\/report\/(\d+)(\/.*)$/.exec(new URL(request.url).pathname) ?? [];
        if (run) this.#reports.set(run, [...(this.#reports.get(run) ?? []), report]);
        return new Response(`${request.headers.get("user-agent") === "own agent" ? "own agent" : "an agent"} ${request.headers.get("x-own")}`);
      };
      this.#servers = [Bun.serve({ port: 0, hostname: "127.0.0.1", fetch }), Bun.serve({ port: 0, hostname: "127.0.0.1", tls: this.tls, fetch })];
    }
    return { PLAIN_URL: `http://127.0.0.1:${this.#servers[0].port}/`, SECURE_URL: `https://localhost:${this.#servers[1].port}/` };
  }

  stop() {
    for (const server of this.#servers) server.stop(true);
  }

  plain(text: string) {
    return text
      .replaceAll(this.folder, "<folder>")
      .replace(/<folder>\/built\/\d+\/(whole|trimmed)/g, "<built>")
      .replace(/<folder>\/run\/\d+/g, "<run>")
      .replace(/\b(listening on |localhost:|127\.0\.0\.1:|\[::1\]:)\d+/g, "$1<port>")
      .replace(/^(. )?Date: .*$/gim, "$1Date: <date>")
      .replace(/\((node|bun):\d+\)/g, "($1:<pid>)")
      .replace(/\b(CPU|Heap)\.[\d.]+(?=\.(cpuprofile|heapprofile|md)\b)/g, "$1.<when>")
      .replace(/\bpid[ =:]+\d+/gi, "pid <pid>")
      // Each executable has an id of its own, which a crash report names.
      .replace(/^Build ID: [0-9a-f]{32}$/gm, "Build ID: <id>")
      // So does what the registers held at a fault, and the code there.
      .replace(/^Registers: .*$/gm, "Registers: <registers>")
      .replace(/^Code at rip: .*$/gm, "Code at rip: <code>")
      .replace(/\bFaults: \d+/g, "Faults: <count>")
      .replace(/\b0x[0-9a-fA-F]+/g, "<address>")
      .replace(/(https:\/\/bun\.report\/[^\/\s]+\/|\/report\/\d+\/[^\/\s]+\/)\S+/g, "$1<trace>")
      .replace(/\b\d+(\.\d+)?\s?(ns|us|µs|ms|s|B|KB|KiB|MB|MiB|GB|GiB|TB)\b/g, "<amount>");
  }

  #runs = 0;
  #looks = 0;

  async lookAt(pid: number, name: string) {
    const services = ["amfid", "syspolicyd", "XprotectService", "taskgated", "trustd"].map(service => `process == "${service}"`).join(" OR ");
    const [processes, sample, log] = await Promise.all(
      [
        ["/bin/ps", "-o", "pid,stat,time,etime,comm", "-p", String(pid)],
        ["/usr/bin/sample", String(pid), "1", "-mayDie"],
        ["/usr/bin/log", "show", "--last", "15s", "--style", "compact", "--predicate", services],
      ].map(async cmd => {
        try {
          await using asked = Bun.spawn({ cmd, env: this.env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 20_000, killSignal: "SIGKILL" });
          return (await Promise.all([asked.stdout.text(), asked.stderr.text()])).join("").trimEnd().split("\n");
        } catch (error) {
          return [`${cmd[0]}: ${error}`];
        }
      }),
    );
    const callGraph = Math.max(0, sample.findIndex(line => line.startsWith("Call graph:")));
    console.error([`SLOW: ${name}: after 10 s:`, ...processes, ...sample.slice(callGraph, callGraph + 60), ...log.slice(-40)].join("\n  "));
  }

  async run(program: Program, how: "whole" | "trimmed", it: Case): Promise<Ran> {
    let executable = await this.executable(program, how, it.build);
    const number = String(this.#runs++);
    const cwd = join(this.folder, "run", number);
    mkdirSync(cwd, { recursive: true });
    const reports = Object.values(it.env ?? {}).some(value => value.includes("<report url>"));
    if (it.calledAs) {
      mkdirSync(join(cwd, "called"));
      symlinkSync(executable, join(cwd, "called", it.calledAs));
      executable = join(cwd, "called", it.calledAs);
    }
    for (const [path, text] of Object.entries(it.files ?? {})) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), text.replaceAll("<run>", cwd).replaceAll("<certificate>", this.tls.cert));
    }
    const laid = new Set(readdirSync(cwd, { recursive: true }) as string[]);
    const env: Record<string, string | undefined> = { ...this.env, PORT: "0", ...(program === "fetches" || reports ? this.servers() : {}) };
    for (const [name, value] of Object.entries(it.env ?? {})) env[name] = value.replaceAll("<run>", cwd).replaceAll("<plain url>", env.PLAIN_URL ?? "").replaceAll("<report url>", env.PLAIN_URL + "report/" + number);
    const args = (it.args ?? []).map(arg => arg.replaceAll("<run>", cwd));
    const streams = { stdin: it.stdin ?? "null", stdout: it.stdout ?? "pipe", stderr: it.stderr ?? "pipe" };
    const redirections = [
      { closed: "<&-", file: `< "$0.in"`, null: "< /dev/null", pipe: "", terminal: "" }[streams.stdin],
      { closed: ">&-", file: `> "$0.out"`, null: "> /dev/null", pipe: "", terminal: "" }[streams.stdout],
      { closed: "2>&-", file: `2> "$0.err"`, null: "2> /dev/null", pipe: "", terminal: "" }[streams.stderr],
    ].join(" ");
    writeFileSync(join(this.folder, "run", "stream-" + this.#runs + ".in"), "from a file\n");
    // Some cases end the program with a signal that dumps core. Where a core is a file, writing it holds up the cases that run beside it, and CI's runner fails a test file beside which one appears.
    const cmd = ["/bin/sh", "-c", `ulimit -c 0 && exec "$@" ${redirections}`, join(this.folder, "run", "stream-" + this.#runs), executable, ...args];
    const usesTerminal = Object.values(streams).includes("terminal");
    let shown = "";
    const answers: string[] = [];
    const child = Bun.spawn({
      cmd,
      cwd,
      env,
      ...(usesTerminal
        ? { terminal: { cols: 80, rows: 24, data: (_: unknown, data: Uint8Array) => void (shown += new TextDecoder().decode(data)) } }
        : { stdin: streams.stdin === "pipe" ? "pipe" : "ignore", stdout: "pipe", stderr: "pipe" }),
      ...(it.ipc ? { serialization: it.ipc, ipc: (message: unknown) => void answers.push("sent " + JSON.stringify(message)) } : {}),
    } as never) as Bun.Subprocess<"pipe", "pipe", "pipe">;
    // TODO: on macOS the first starts of a fresh trimmed executable have said nothing for more than ten seconds, while the whole one that
    // was started beside it answered. Why is not known. Until it is, a run has a minute, and the log names every run that took over ten seconds.
    const started = performance.now();
    let timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    let looked: Promise<void> | undefined;
    const look = setTimeout(() => {
      if (process.platform === "darwin" && !it.signal && this.#looks++ < 3) looked = this.lookAt(child.pid, `${program}, ${how}: ${it.name}`);
    }, 10_000);
    let stdout = "";
    try {
      // A program that takes nothing from its parent may have ended by now: then there is nobody to tell.
      const tell = async (say: () => unknown) => {
        try {
          await say();
        } catch (error) {
          const hasEnded = child.exitCode !== null || child.signalCode !== null;
          if (!hasEnded && (error as NodeJS.ErrnoException).code !== "EPIPE") throw error;
        }
      };
      if (it.ipc) await tell(() => child.send({ from: "the parent", when: new Date(0), pattern: /a/ }));
      if (!usesTerminal && streams.stdin === "pipe") {
        await tell(async () => {
          child.stdin.write("from a pipe\n");
          await child.stdin.end();
        });
      }
      const stderr = usesTerminal ? Promise.resolve("") : child.stderr.text();
      if (program === "serve" && !usesTerminal && streams.stdout === "pipe") {
        const reader = child.stdout.getReader();
        const decoder = new TextDecoder();
        let port: string | undefined;
        while (!(port = /listening on (\d+)/.exec(stdout)?.[1])) {
          const { value, done } = await reader.read();
          if (done) break;
          stdout += decoder.decode(value, { stream: true });
        }
        if (port) {
          const base = "http://127.0.0.1:" + port;
          for (const [path, init] of [["/text"], ["/json"], ["/echo", { method: "POST", body: `{"title":"x"}`, headers: { "content-type": "application/json" } }], ["/nothing"]] as [string, RequestInit?][]) {
            answers.push(await fetch(base + path, init).then(async answer => `${answer.status} ${await answer.text()}`, error => "no answer: " + error.code));
          }
          child.kill(it.signal ?? "SIGTERM");
          // It has answered, so it has started. A server that the signal has stopped answers nothing more: it is ended ten seconds from here.
          clearTimeout(timer);
          timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
          if (it.signal && (await Promise.race([child.exited, Bun.sleep(3000).then(() => "runs on")])) === "runs on") {
            const answer = await fetch(base + "/text").then(async answer => `${answer.status} ${await answer.text()}`, () => "no answer");
            // A server that answers nothing more is ending, and how long that takes depends on what else the machine does: it is waited for. Only one that still answers runs on.
            if (answer !== "no answer") {
              answers.push("runs on: " + answer);
              child.kill("SIGKILL");
            }
          }
        }
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          stdout += decoder.decode(value, { stream: true });
        }
      } else if (!usesTerminal) {
        stdout = await child.stdout.text();
      }
      const exitCode = await child.exited;
      for (let waited = 0; reports && waited < 3000 && !this.#reports.has(number); waited += 50) await Bun.sleep(50);
      if (reports) answers.push("reported " + (this.#reports.get(number) ?? []).map(report => report.replace(/^(\/[^\/]+\/).*?(\/ack)?$/, "$1<trace>$2")).join(" "));
      const written = (readdirSync(cwd, { recursive: true }) as string[]).filter(path => !laid.has(path)).map(path => path.replace(/\d+/g, "N")).sort();
      return {
        stdout: this.plain(usesTerminal ? shown : stdout),
        stderr: this.plain(await stderr),
        exit: child.signalCode ?? String(exitCode),
        answers: answers.join(" | "),
        written: written.join(" "),
      };
    } finally {
      clearTimeout(timer);
      clearTimeout(look);
      await looked;
      const seconds = (performance.now() - started) / 1000;
      if (seconds > 10 && !it.signal) console.error(`SLOW: ${program}, ${how}: ${it.name}: ${seconds.toFixed(1)} s`);
      rmSync(cwd, { recursive: true, force: true });
    }
  }

  async both(program: Program, it: Case) {
    const [whole, trimmed] = await Promise.all([this.run(program, "whole", it), this.run(program, "trimmed", it)]);
    if (it.numbersMayDiffer) {
      // The kernel hands a signal sent to the process to any of its threads.
      for (const ran of [whole, trimmed]) for (const key of ["stdout", "stderr"] as const) ran[key] = ran[key].replace(/\d+/g, "N").replace(/^panic\([^)\n]*\): /gm, "panic: ");
    }
    return { whole, trimmed };
  }
}

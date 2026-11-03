import { expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { isWindows, tempDir } from "harness";
import { join } from "path";

const python = Bun.which("python3");
const pythonHasFcntlAndResource = !isWindows;

function report(lines: [number, string, string][]) {
  return lines
    .map(([samples, dso, symbol]) => `${String(samples).padStart(8)}  ${dso.padEnd(18)}[.] ${symbol}\n`)
    .join("");
}

test.skipIf(!python)("measure/layers.py charges every sample to the layer that owns the code", () => {
  using dir = tempDir("aot-servers-layers", {});
  const files = {
    aot: report([
      [10, "[JIT] tid 103", "renderInline markdown.ts:24"],
      [10, "[JIT] tid 103", "(stubs of compiled code)"],
      [5, "[JIT] tid 103", "flushConcurrentQueries internal:sql/shared:1139"],
      [5, "[JIT] tid 103", "map :1"],
      [10, "server-aot", "uWS::AsyncSocket<false>::write"],
      [5, "server-aot", "<bun_sql_jsc::postgres::data_cell::Putter>::put"],
      [5, "server-aot", "Bun::jsFunctionBunEscapeHTML"],
      [10, "server-aot", "JSC::JSRopeString::resolveRope"],
      [5, "server-aot", "operationAOTJSONAppendString"],
      [5, "server-aot", "llint_predecoded_get_by_id_inline"],
      [5, "server-aot", "icu_75::SimpleDateFormat::subFormat"],
      [5, "server-aot", "JSC::MarkedBlock::Handle::sweep"],
      [5, "server-aot", "JSC::SlotVisitor::drain"],
      [5, "server-aot", "mi_malloc"],
      [5, "server-aot", "operator delete[]"],
      [5, "libc.so.6", "__memmove_avx512_unaligned_erms"],
      [7, "[unknown]", "0xffffffffb4c00ed0"],
    ]),
    jit: report([
      [50, "[JIT] tid 90", "0x00007f305b3f599d"],
      [25, "server-jit", "JSC::FastStringifier<WTF::Latin1Character, (JSC::BufferMode)0>::append"],
      [25, "server-jit", "us_internal_dispatch_ready_poll"],
    ]),
    released: report([
      [50, "[JIT] tid 90", "0x00007fc844ff42c7"],
      [40, "server-released", "0x0000000001cc772c"],
      [10, "libc.so.6", "__memset_avx512_unaligned_erms"],
    ]),
    go: report([
      [40, "go", "main.renderInline"],
      [20, "go", "github.com/jackc/pgx/v5.(*baseRows).Scan"],
      [10, "go", "runtime.mallocgc"],
      [10, "go", "runtime.scanobject"],
      [10, "go", "runtime.memmove"],
      [10, "go", "runtime.schedule"],
    ]),
    rust: report([
      [40, "rust", "tracker::markdown::render_inline"],
      [20, "rust", "tokio_postgres::row::Row::try_get"],
      [10, "rust", "mi_free"],
      [10, "rust", "core::ptr::drop_in_place<alloc::string::String>"],
      [10, "libc.so.6", "__memmove_avx512_unaligned_erms"],
      [10, "rust", "core::fmt::write"],
    ]),
  };
  const words = Object.entries(files).map(([name, text]) => {
    writeFileSync(join(String(dir), name + ".txt"), text);
    return `${name === "released" ? "released:stripped" : name}=${join(String(dir), name + ".txt")}`;
  });
  const run = Bun.spawnSync([python!, join(import.meta.dir, "measure", "layers.py"), ...words]);
  expect(run.stderr.toString()).toBe("");
  const shares = run.stdout
    .toString()
    .trim()
    .split(/\r?\n/)
    .slice(2)
    .map(line => line.split(" | ").slice(-5).join(" ").replace(/ \|$/, "").replace(/\s+/g, " ").trim());
  expect(shares).toEqual([
    "10.0% 50.0% 50.0% 40.0% 40.0%",
    "10.0%",
    "10.0%",
    "5.0%",
    "20.0% 25.0% 40.0% 20.0% 20.0%",
    "15.0% 25.0% 10.0% 10.0%",
    "5.0%",
    "10.0% 10.0% 10.0%",
    "10.0% 10.0% 10.0%",
    "5.0% 10.0% 10.0% 10.0%",
  ]);
});

function python3(dir: string, code: string) {
  const run = Bun.spawnSync(
    [
      python!,
      "-c",
      `import json, sys\nsys.path.insert(0, ${JSON.stringify(join(import.meta.dir, "measure"))})\nimport layers\n${code}`,
    ],
    { cwd: dir },
  );
  expect(run.stderr.toString()).toBe("");
  return JSON.parse(run.stdout.toString());
}

test.skipIf(!python)("measure/layers.py names the stub that a sampled address falls into", () => {
  using dir = tempDir("aot-servers-stubs", {
    "perf.map": "1000 100 handle server.ts:3\n2000 300 (stubs of compiled code)\n5000 300 (stubs of compiled code)\n",
    "image.map": "F\t0\t0\tmain\nT\t0\tCall\nT\t256\tGetByName3\nT\t512\tGetByName4KeepingTwo\n",
  });
  const addresses = [0x1010, 0x2000, 0x20ff, 0x2100, 0x2200, 0x5101, 0x52ff, 0x5300];
  expect(
    python3(
      String(dir),
      `print(json.dumps(layers.count_stubs(${JSON.stringify(addresses)}, "perf.map", "image.map")))`,
    ),
  ).toEqual({ Call: 2, GetByNameN: 4 });
  expect(
    python3(String(dir), `print(json.dumps(layers.count_stubs([], "no-such.map", "no-such.map").most_common(3)))`),
  ).toEqual([]);
});

test.skipIf(!python)("measure/layers.py charges a sample to the nearest compiled function up the stack", () => {
  using dir = tempDir("aot-servers-chains", {
    "script.txt": [
      "\t    2010 (stubs of compiled code)+0x10 (/tmp/perf-7.map)",
      "\t    1010 emit node:events:219+0x10 (/tmp/perf-7.map)",
      "\t    1110 handle server.ts:3+0x10 (/tmp/perf-7.map)",
      "",
      "\t  400100 JSC::JSRopeString::resolveRope+0x4 (/work/bin/server-aot)",
      "\t    1110 handle server.ts:3+0x10 (/tmp/perf-7.map)",
      "",
      "\t  400200 uWS::HttpParser::getHeaders+0x8 (/work/bin/server-aot)",
      "\t  400300 us_internal_dispatch_ready_poll+0x2 (/work/bin/server-aot)",
      "",
    ].join("\n"),
  });
  const counts = python3(
    String(dir),
    `print(json.dumps(sorted([list(key) + [count] for key, count in layers.read_call_chains(open("script.txt")).items()])))`,
  );
  expect(counts).toEqual([
    ["engine", "application", 1],
    ["native", "nobody", 1],
    ["stubs", "modules", 1],
  ]);
});

test.skipIf(!python)(
  "measure/compare.py prints no number for a row that was read while other work ran on its cores",
  () => {
    const start = (rate: number) => ({ requests_per_second: rate, cycles: 1000, instructions: 2000, cpu_us: 1 });
    const row = (route: string, column: string, rate: number, isVoid: boolean) =>
      JSON.stringify({
        server: "bun",
        route,
        column,
        void: isVoid,
        starts: { "1": start(rate) },
        requests_per_second: rate,
        cycles: 1000,
        instructions: 2000,
        cpu_us: 1,
        ready_rss_mb: 1,
        peak_rss_mb: 1,
        private_mb: 1,
        first_response_ms: 1,
        p50_us: 1,
        p99_us: 1,
        stable: true,
        settled: true,
      });
    using dir = tempDir("aot-servers-void", {
      "rows.jsonl":
        [
          row("text", "aot", 200, false),
          row("text", "released", 100, false),
          row("json", "aot", 7777, true),
          row("json", "released", 100, false),
        ].join("\n") + "\n",
    });
    const run = Bun.spawnSync(
      [python!, join(import.meta.dir, "measure", "compare.py"), "rows.jsonl", "aot", "released"],
      { cwd: String(dir) },
    );
    expect(run.stderr.toString()).toBe("");
    const printed = run.stdout.toString();
    expect(printed).toContain("Void, because other work ran on their cores: bun json aot.");
    expect(printed).toContain("+100.0%");
    expect(printed).not.toContain("7777");
  },
);

test.skipIf(!python || !pythonHasFcntlAndResource)(
  "measure/measure.py runs every column from a copy whose path has the same length",
  () => {
    using dir = tempDir("aot-servers-copies", {});
    const paths = python3(
      String(dir),
      [
        "import argparse, measure",
        'columns = [{"name": "a"}, {"name": "a-much-longer-name"}]',
        'options = argparse.Namespace(work=".", columns=columns)',
        'print(json.dumps([measure.Server(options, {"server": 4}, {}, "bun", {"name": "text"}, column).copy for column in columns]))',
      ].join("\n"),
    );
    expect(paths[0]).not.toBe(paths[1]);
    expect(paths[0].length).toBe(paths[1].length);
  },
);

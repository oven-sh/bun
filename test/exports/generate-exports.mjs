// This generates a list of all the shapes of all builtin modules and their typeof values.
//
// To run:
//
//   bun generate-exports.mjs > node-exports.bun-${version}.json
//   bun generate-exports.mjs bun > bun-exports.bun-${version}.json
//   node generate-exports.mjs > node-exports.node-$(node --version).json
//
import { createRequire } from "node:module";
import process from "node:process";

const nodeBuiltins = [
  "_http_agent",
  "_http_client",
  "_http_common",
  "_http_incoming",
  "_http_outgoing",
  "_http_server",
  "_stream_duplex",
  "_stream_passthrough",
  "_stream_readable",
  "_stream_transform",
  "_stream_wrap",
  "_stream_writable",
  "_tls_common",
  "_tls_wrap",
  "assert",
  "assert/strict",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "dns/promises",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "inspector/promises",
  "module",
  "net",
  "os",
  "path",
  "path/posix",
  "path/win32",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "readline/promises",
  "repl",
  "stream",
  "stream/consumers",
  "stream/promises",
  "stream/web",
  "string_decoder",
  "sys",
  "test/reporters",
  "timers",
  "timers/promises",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "util/types",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]
  .map(a => "node:" + a)
  .sort();

const bunBuiltins = [
  "buffer",
  "bun:ffi",
  "bun:jsc",
  "bun:main",
  "bun:sqlite",
  "bun:events_native",
  "node:assert",
  "node:assert/strict",
  "node:async_hooks",
  "node:buffer",
  "node:child_process",
  "node:cluster",
  "node:crypto",
  "node:dgram",
  "node:diagnostics_channel",
  "node:dns",
  "node:dns/promises",
  "node:events",
  "node:fs",
  "node:fs/promises",
  "node:http",
  "node:http2",
  "node:https",
  "node:inspector",
  "node:module",
  "node:net",
  "node:os",
  "node:path",
  "node:path/posix",
  "node:path/win32",
  "node:perf_hooks",
  "node:process",
  "node:readline",
  "node:readline/promises",
  "node:repl",
  "node:stream",
  "node:stream/consumers",
  "node:stream/promises",
  "node:stream/web",
  "node:string_decoder",
  "node:timers",
  "node:timers/promises",
  "node:tls",
  "node:trace_events",
  "node:tty",
  "node:url",
  "node:util",
  "node:util/types",
  "node:v8",
  "node:vm",
  "node:wasi",
  "node:zlib",
].sort();

const require = createRequire(import.meta.url);

const imported = {};
const required = {};
const errors = {};

function resolveNested([key, v], stop) {
  let nested;
  if ((v && typeof v === "object") || typeof v === "function") {
    const entries = Object.fromEntries(
      Object.entries(v)
        .map(([ak, av]) => {
          var display = typeof av;

          if (av && (typeof av === "function" || typeof av === "object")) {
            const list = Object.fromEntries(
              Object.entries(av)
                .map(([ak2, av2]) => [ak2, typeof av2])
                .sort(),
            );

            for (let key in list) {
              display = list;
              break;
            }
          }

          return [ak, display];
        })
        .sort(),
    );

    for (let key in entries) {
      nested = entries;
      break;
    }
  }

  return [key, nested || typeof v];
}

async function processBuiltins(builtins) {
  for (const builtin of builtins) {
    try {
      imported[builtin] = Object.fromEntries(
        Object.entries(await import(builtin))
          .map(resolveNested)
          .sort(),
      );
      required[builtin] = Object.fromEntries(Object.entries(require(builtin)).map(resolveNested).sort());
    } catch ({ name, message }) {
      errors[builtin] = { name, message };
    }
  }
}

process.stdout.write(
  JSON.stringify(
    {
      builtins: await processBuiltins(process.argv.at(-1) === "bun" ? bunBuiltins : nodeBuiltins),
      import: imported,
      require: required,
      runtime: typeof Bun !== "undefined" ? "bun" : "node",
      version: typeof Bun !== "undefined" ? Bun.version : process.version,
      errors,
    },
    null,
    2,
  ),
);

import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `AsyncHTTP::init_sync` is how CLI commands (install, publish, audit, pm view,
// upgrade, create, ...) make a blocking request, and its `http_proxy` argument
// is the only way the request learns about http_proxy / https_proxy /
// NO_PROXY. A literal `None` there is a command that silently ignores the
// proxy environment every other command honours: `bun audit` shipped that way
// (#20295), and so did `bun publish` and `bun pm whoami`. Resolve it from the
// environment instead, for the URL being requested:
//
//   let http_proxy = pm.http_proxy(&url);                   // with a PackageManager
//   let http_proxy = env_loader.get_http_proxy_for(&url);   // with a dotenv Loader
//
// Both return `None` when no proxy applies, so there is never a reason to
// write the literal. The argument is found by position, so the lint also
// fails if the signature changes shape; update INIT_SYNC_ARGS along with it.

const INIT_SYNC_ARGS = [
  "method",
  "url",
  "headers",
  "headers_buf",
  "request_body",
  "http_proxy",
  "hostname",
  "redirect_type",
];
const HTTP_PROXY_ARG = INIT_SYNC_ARGS.indexOf("http_proxy");
const CALL = "AsyncHTTP::init_sync(";

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rustSources = globAllSources().rust.filter(p => p.endsWith(".rs"));

// Only scan files tracked in HEAD (a `git stash` round-trip can leave stray
// `.rs` files in the working tree; CI runs on a clean checkout). Same guard as
// dead-code-escapes.test.ts.
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

// A string or char literal (`"..."`, `b"..."`, `'x'`, `b'\n'`) starting at
// lastIndex; a lifetime (`'a`) has no closing quote after its first character
// and does not match.
const LITERAL = /b?"(?:\\[\s\S]|[^\\"])*"|b?'(?:\\[\s\S]|[^\\'])'/y;
const COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?\*\//y;

function matchAt(re: RegExp, source: string, at: number): string | null {
  re.lastIndex = at;
  return re.exec(source)?.[0] ?? null;
}

/** Replaces comments with spaces (line count preserved); literals are kept as-is. */
function stripComments(source: string): string {
  let out = "";
  for (let i = 0; i < source.length; ) {
    const literal = matchAt(LITERAL, source, i);
    if (literal !== null) {
      out += literal;
      i += literal.length;
      continue;
    }
    const comment = matchAt(COMMENT, source, i);
    if (comment !== null) {
      out += comment.replace(/[^\n]/g, " ");
      i += comment.length;
      continue;
    }
    out += source[i++];
  }
  return out;
}

/**
 * The arguments of the call whose `(` is at `source[open]`, split on the
 * commas at nesting depth 0, or `null` if the call is never closed.
 */
function callArguments(source: string, open: number): string[] | null {
  const args: string[] = [];
  let current = "";
  let depth = 0;
  for (let i = open + 1; i < source.length; ) {
    const literal = matchAt(LITERAL, source, i);
    if (literal !== null) {
      current += literal;
      i += literal.length;
      continue;
    }
    const c = source[i++]!;
    if (c === "(" || c === "[" || c === "{") depth++;
    if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) {
        if (current.trim() !== "") args.push(current.trim());
        return args;
      }
      depth--;
    }
    if (c === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += c;
  }
  return null;
}

const offenders: string[] = [];
let calls = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  const content = await file(abs).text();
  if (!content.includes(CALL)) continue;
  const code = stripComments(content);
  for (let at = code.indexOf(CALL); at !== -1; at = code.indexOf(CALL, at + CALL.length)) {
    calls++;
    const where = `${source}:${code.slice(0, at).split("\n").length}`;
    const args = callArguments(code, at + CALL.length - 1);
    if (args === null || args.length !== INIT_SYNC_ARGS.length) {
      offenders.push(
        `${where}: expected the ${INIT_SYNC_ARGS.length} arguments (${INIT_SYNC_ARGS.join(", ")}), found ${args?.length ?? "an unterminated call"}; update this lint if init_sync changed`,
      );
    } else if (args[HTTP_PROXY_ARG] === "None") {
      offenders.push(`${where}: AsyncHTTP::init_sync with http_proxy: None; resolve it from the environment`);
    }
  }
}

test("scans the AsyncHTTP::init_sync call sites", () => {
  expect(calls).toBeGreaterThan(0);
});

test("every AsyncHTTP::init_sync call resolves http_proxy from the environment", () => {
  expect(offenders).toEqual([]);
});

import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// fetch() completes a response body with no Content-Length and no chunked framing only when the connection reached
// the end of the peer's stream (`is_body_complete_on_close`, src/http/InternalState.rs). It knows a reset from that
// end by the errno of the recv() that failed. The kernel gives the errno of a reset to one caller: the first recv(),
// send() or read of SO_ERROR after the reset. A read of SO_ERROR, or a send outside the helper, takes a reset's errno
// out of the kernel. The next recv() then returns 0, and the body that the reset cut short ends like a FIN.
//
// So these two lists are closed:
//   1. In the HTTP/1 client (src/http/lib.rs) only `write_once` writes to the socket. It keeps the ECONNRESET of a
//      failed send for `HTTPClient::on_close`. Send a request with `write_to_socket`. Two writers are outside the
//      rule and outside this list: sendfile() of a `Bun.file` upload takes the raw fd, and a CONNECT tunnel writes
//      in src/http/ProxyTunnel.rs.
//   2. In src/http, SO_ERROR (`get_error`, `is_closed_or_has_error`) is read only by the functions in `readers`.
//      A new reader needs the same proof as they have: no body can still end on that socket after the read.
const why =
  "A read of SO_ERROR, or a send outside write_once, takes a reset's errno out of the kernel, " +
  "and the close-delimited body that the reset cut short then ends like a FIN. See the comment in this file.";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

// Every call that `pattern` finds in `file`, as "<the function it is in>: <the method>".
function calls(file: string, pattern: RegExp) {
  // A comment line is not a call.
  const code = readFileSync(path.join(repoRoot, file), "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
  return [...code.matchAll(pattern)]
    .map(match => {
      const enclosing = [...code.slice(0, match.index).matchAll(/\bfn\s+(\w+)/g)].at(-1)?.[1];
      return `${enclosing ?? "(no function)"}: ${match[1]}`;
    })
    .sort();
}

test("the HTTP/1 client writes to its socket in write_once only", () => {
  const writes = calls("src/http/lib.rs", /\b\w*sock\w*\s*\.\s*(\w*write\w*)\s*\(/g);
  expect(writes, why).toEqual(["write_once: write", "write_once: write_check_error"]);
});

test("src/http reads SO_ERROR only where no body can still end", async () => {
  const readers = {
    "src/http/HTTPContext.rs": [
      // A pooled socket, before a request takes it.
      "find_in: get_error",
      // The exchange is over: pool the socket or drop it.
      "release_socket: get_error",
    ],
    "src/http/h2_client/ClientSession.rs": [
      // HTTP/2 frames its bodies: none of them ends when the connection closes.
      "fail_all: is_closed_or_has_error",
      "maybe_release: is_closed_or_has_error",
    ],
    "src/http/lib.rs": [
      // The response was a redirect: pool the socket or drop it.
      "do_redirect: is_closed_or_has_error",
      // Only where the rule is off (`!STRICT_READ_END`).
      "maybe_pause_receive: get_error",
      // The body is complete: resume the socket and pool it, or drop it.
      "send_one_progress_update: is_closed_or_has_error",
      "send_one_progress_update: is_closed_or_has_error",
    ],
  };

  const found: Record<string, string[]> = {};
  let scanned = 0;
  for await (const rel of new Glob("**/*.rs").scan({ cwd: path.join(repoRoot, "src/http") })) {
    const file = path.join("src/http", rel).replaceAll("\\", "/");
    scanned++;
    const reads = calls(file, /\.\s*(get_error|is_closed_or_has_error)\s*\(/g);
    if (reads.length > 0) found[file] = reads;
  }
  // Guard against repoRoot resolving wrong, which would make the lint pass vacuously.
  expect(scanned).toBeGreaterThan(20);
  expect(found, why).toEqual(readers);
});

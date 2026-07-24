import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Location.namespace was a lifetime-erased borrow of source.path.namespace.
// For a plugin namespace (a heap-allocated JS string converted at the
// onResolve boundary), that borrow outlives the backing bytes: by the time
// the BuildMessage is read, the first word of the original allocation has
// been recycled, so the namespace comes back with its prefix overwritten.
// With Location.namespace owning its bytes (Box<[u8]>), the message is
// self-contained and the value round-trips exactly.
test("BuildMessage.position.namespace owns its bytes for plugin-supplied namespaces", async () => {
  const fixture = `
    // Force a fresh heap allocation for the namespace (not a rope, not a
    // literal) so nothing else keeps the underlying bytes alive. Must match
    // the onLoad namespace regex (/$a-zA-Z0-9_\\-/).
    const ns = Buffer.from("plugin-ns-" + Date.now() + "-" + process.pid).toString();

    const result = await Bun.build({
      entrypoints: ["virtual:entry"],
      throw: false,
      plugins: [{
        name: "p",
        setup(b) {
          b.onResolve({ filter: /^virtual:/ }, args => ({ path: args.path, namespace: ns }));
          b.onLoad({ filter: /.*/, namespace: ns }, () => ({
            contents: "syntax error here !!!",
            loader: "js",
          }));
        },
      }],
    });

    Bun.gc(true);

    const got = result.logs[0]?.position?.namespace;
    if (got !== ns) {
      console.error(JSON.stringify({ got, expected: ns }));
      process.exit(1);
    }
    console.log("ok");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr.trim()).toBe("");
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

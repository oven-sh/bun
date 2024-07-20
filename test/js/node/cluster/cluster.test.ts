import { expect, test } from "bun:test";
import path from "node:path";
import "harness";

function new_test(name: string) {
  test(name, () => {
    expect([
      path.resolve(import.meta.dir, `../../../../`, `test/node.js/upstream/test/parallel/test-cluster-${name}`),
    ]).toRun();
  });
}

new_test("advanced-serialization.js");
new_test("bind-privileged-port.js");
new_test("call-and-destroy.js");
new_test("child-index-dgram.js");
new_test("child-index-net.js");
new_test("concurrent-disconnect.js");
new_test("cwd.js");
new_test("disconnect-before-exit.js");
new_test("disconnect-exitedAfterDisconnect-race.js");
new_test("disconnect-idle-worker.js");
new_test("disconnect-leak.js");
new_test("disconnect-with-no-workers.js");
new_test("fork-env.js");
new_test("fork-windowsHide.js");
new_test("invalid-message.js");
new_test("kill-disconnect.js");
new_test("kill-infinite-loop.js");
new_test("listening-port.js");
new_test("primary-error.js");
new_test("primary-kill.js");
new_test("process-disconnect.js");
new_test("rr-domain-listen.js");
new_test("rr-handle-keep-loop-alive.js");
new_test("rr-ref.js");
new_test("send-deadlock.js");
new_test("setup-primary-argv.js");
new_test("setup-primary-cumulative.js");
new_test("setup-primary-emit.js");
new_test("setup-primary-multiple.js");
new_test("setup-primary.js");
new_test("shared-handle-bind-privileged-port.js");
new_test("uncaught-exception.js");
new_test("worker-constructor.js");
new_test("worker-death.js");
new_test("worker-destroy.js");
new_test("worker-disconnect-on-error.js");
new_test("worker-disconnect.js");
new_test("worker-events.js");
new_test("worker-exit.js");
new_test("worker-forced-exit.js");
new_test("worker-init.js");
new_test("worker-isdead.js");
new_test("worker-kill-signal.js");
new_test("worker-kill.js");
new_test("worker-no-exit.js");

test("docs-http-server.ts", () => {
  expect([path.join(import.meta.dir, "docs-http-server.ts")]).toRun();
});
test("worker-no-exit-http.ts", () => {
  expect([path.join(import.meta.dir, "worker-no-exit-http.ts")]).toRun();
});

import { expect, test } from "bun:test";
import path from "node:path";
import "harness";
import { isLinux, isWindows } from "harness";

function new_test(name: string, skip: boolean = false) {
  test.skipIf(skip)(name, () => {
    expect([path.join(import.meta.dir, `upstream`, `parallel`, `test-cluster-${name}`)]).toRun();
  });
}

new_test("advanced-serialization.js");
new_test("bind-privileged-port.js");
new_test("call-and-destroy.js", isWindows);
new_test("child-index-dgram.js");
new_test("child-index-net.js", isWindows);
new_test("concurrent-disconnect.js", isLinux || isWindows);
new_test("cwd.js", isWindows);
new_test("disconnect-before-exit.js", isWindows);
new_test("disconnect-exitedAfterDisconnect-race.js", isWindows);
new_test("disconnect-idle-worker.js", isWindows);
new_test("disconnect-leak.js", isWindows);
new_test("disconnect-with-no-workers.js");
new_test("fork-env.js");
new_test("fork-windowsHide.js", isWindows);
new_test("invalid-message.js", isWindows);
new_test("kill-disconnect.js", isWindows);
new_test("kill-infinite-loop.js", isWindows);
new_test("listening-port.js", isWindows);
new_test("primary-error.js");
new_test("primary-kill.js");
new_test("process-disconnect.js", isWindows);
new_test("rr-domain-listen.js");
new_test("rr-handle-keep-loop-alive.js");
new_test("rr-ref.js", isWindows);
new_test("send-deadlock.js", isWindows);
new_test("setup-primary-argv.js");
new_test("setup-primary-cumulative.js");
new_test("setup-primary-emit.js");
new_test("setup-primary-multiple.js");
new_test("setup-primary.js");
new_test("shared-handle-bind-privileged-port.js");
new_test("uncaught-exception.js");
new_test("worker-constructor.js");
new_test("worker-death.js");
new_test("worker-destroy.js", isWindows);
new_test("worker-disconnect-on-error.js", isWindows);
new_test("worker-disconnect.js", isWindows);
new_test("worker-events.js");
new_test("worker-exit.js", isWindows);
new_test("worker-forced-exit.js", isWindows);
new_test("worker-init.js", isWindows);
new_test("worker-isdead.js");
new_test("worker-kill-signal.js", isWindows);
new_test("worker-kill.js", isWindows);
new_test("worker-no-exit.js", isLinux || isWindows);

test("docs-http-server.ts", () => {
  expect([path.join(import.meta.dir, "docs-http-server.ts")]).toRun();
});
test.skipIf(isWindows)("worker-no-exit-http.ts", () => {
  expect([path.join(import.meta.dir, "worker-no-exit-http.ts")]).toRun();
});

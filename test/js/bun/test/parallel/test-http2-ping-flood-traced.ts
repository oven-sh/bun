// Verbatim shape of test/js/node/test/sequential/test-http2-ping-flood.js,
// which times out silently (multiple 20s attempts, zero output) on
// windows-11-aarch64 only, while staged bun:test twins covering the same
// contract pass on that lane over every loopback family. Breadcrumbs are
// fs.writeSync (async pipe writes are lost when the runner hard-kills) and
// the watchdog interval is REF'D - during these silent stalls unref'd timers
// have been observed never to fire (see #34158).
import { createTest } from "node-harness";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
const { expect } = createTest(import.meta.path);

const steps: string[] = [];
const step = (s: string) => {
  steps.push(s);
  fs.writeSync(2, `STEP: ${s}\n`);
};
let ticks = 0;
let doneReached = false;
const watchdog = setInterval(() => {
  ticks++;
  if (!doneReached) {
    fs.writeSync(2, `TICK ${ticks}: after: ${steps.join(" -> ")}\n`);
  } else {
    // Post-done phase: every stage succeeded but the process is not exiting.
    // Dump the client socket's state to tell a zombie socket (loop alive,
    // socket never learns the peer died) from a wedged loop (no ticks at all
    // would print - the #34158 class, but client-side).
    const c: any = client;
    fs.writeSync(
      2,
      `TICK ${ticks} post-done: client destroyed=${c?.destroyed} readyState=${c?.readyState} pending=${c?.pending} bytesWritten=${c?.bytesWritten} bufferSize=${c?.bufferSize}\n`,
    );
  }
  if (ticks >= 3) {
    fs.writeSync(2, `WATCHDOG: stalled ${doneReached ? "post-done" : "pre-done"}\n`);
    process.exit(1);
  }
}, 5_000);
process.on("beforeExit", () => {
  fs.writeSync(2, "clean-exit\n");
  clearInterval(watchdog);
});

const kClientMagic = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
const kSettings = Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0]);
const kPing = Buffer.from([0, 0, 8, 6, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);

const server = http2.createServer();
let interval: ReturnType<typeof setInterval> | undefined;

const done = Promise.withResolvers<void>();
server.on("session", session => {
  step("session");
  session.on("error", (e: any) => {
    step(`session-error:${e.code}`);
    expect(e.code).toBe("ERR_HTTP2_ERROR");
    expect(e.message).toContain("Flooding was detected");
    clearInterval(interval);
  });
  session.on("close", () => {
    step("session-close");
    server.close(() => {
      step("server-closed");
      done.resolve();
    });
  });
});

// Like the vendored test: default-host listen and connect (dual-stack path).
let client: net.Socket | undefined;
server.listen(0, () => {
  step("listening");
  client = net.connect((server.address() as net.AddressInfo).port);
  client.on("error", () => step("client-error"));
  client.on("close", () => step("client-close"));
  client.on("connect", () => {
    step("client-connect");
    client.write(kClientMagic, () => {
      client.write(kSettings, () => {
        step("flood-start");
        interval = setInterval(() => {
          for (let n = 0; n < 10000; n++) client.write(kPing);
        }, 1);
      });
    });
  });
});

await done.promise;
step("done");
doneReached = true;
ticks = 0;
// Unref for the post-done phase: if only this interval remains the process
// exits cleanly (beforeExit prints); a ref'd zombie handle keeps the loop
// alive and the unref'd ticks still fire and dump its state.
watchdog.unref?.();
client_cleanup: {
  // the vendored test leaves the client to die with the process; keep that
  // shape (no explicit destroy) so the teardown path matches exactly
}

// During the half-close teardown stalls on the Windows agents, an unref'd
// 15s watchdog (fs.writeSync-instrumented) never fired inside a 20s window.
// On Linux, unref'd timers fire on time while the loop only waits on sockets
// (bun +1705ms vs node +1516ms for a 1500ms timer). This pins the same
// contract on every agent: an unref'd timer must fire while ref'd socket
// work keeps the loop alive. If it fails on the Windows lanes, that is a
// standalone timer/poll-integration bug and explains the silent watchdogs;
// if it passes, the stalled runs' loops were genuinely wedged.
import { createTest } from "node-harness";
import net from "node:net";
import fs from "node:fs";
const { expect } = createTest(import.meta.path);

const t0 = Date.now();
const fired = Promise.withResolvers<number>();

const server = net.createServer(() => {});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const client = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
client.on("error", () => {});

const timer = setTimeout(() => fired.resolve(Date.now() - t0), 1_500);
timer.unref();
const kill = setTimeout(() => {
  fs.writeSync(2, `unref'd timer never fired after ${Date.now() - t0}ms of socket-wait\n`);
  process.exit(1);
}, 10_000);

const elapsed = await fired.promise;
fs.writeSync(2, `unref'd timer fired at +${elapsed}ms\n`);
clearTimeout(kill);
client.destroy();
server.close();
expect(elapsed).toBeGreaterThanOrEqual(1_400);
expect(elapsed).toBeLessThan(9_000);

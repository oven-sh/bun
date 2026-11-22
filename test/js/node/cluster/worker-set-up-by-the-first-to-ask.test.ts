import { expect, test } from "bun:test";
import { bunExe, isWindows } from "harness";
import { join } from "node:path";
import { run } from "../../../aot/harness/run";

const expected = [
  'dgram-exclusive: message {"had":true,"has":false,"isWorker":true,"id":"number","state":"online","same":true,"keys":"Worker,_events,_eventsCount,_getServer,_maxListeners,_setupWorker,isMaster,isPrimary,isWorker,worker","extra":"after false number"} | online | exit 0',
  'dgram-not-a-worker: message {"had":true,"has":false,"isWorker":false,"id":"number","state":"online","same":true,"keys":"Worker,_events,_eventsCount,_getServer,_maxListeners,_setupWorker,isMaster,isPrimary,isWorker,worker","extra":"bound number"} | online | exit 0',
  'dgram-only: listening number udp4 | message {"had":true,"has":false,"isWorker":true,"id":"number","state":"online","same":true,"keys":"Worker,_events,_eventsCount,_getServer,_maxListeners,_setupWorker,isMaster,isPrimary,isWorker,worker","extra":"after false number"} | online | exit 0',
  'http-only: listening number 4 | message {"had":true,"has":false,"isWorker":true,"id":"number","state":"online","same":true,"keys":"Worker,_events,_eventsCount,_getServer,_maxListeners,_setupWorker,isMaster,isPrimary,isWorker,worker","extra":"after false"} | online | exit 0',
  'net-only: listening number 4 | message {"had":true,"has":false,"isWorker":true,"id":"number","state":"online","same":true,"keys":"Worker,_events,_eventsCount,_getServer,_maxListeners,_setupWorker,isMaster,isPrimary,isWorker,worker","extra":"after false"} | online | exit 0',
  'net-then-cluster: listening number 4 | message {"had":true,"has":false,"isWorker":true,"id":"number","state":"listening","same":true,"keys":"Worker,_events,_eventsCount,_getServer,_maxListeners,_setupWorker,isMaster,isPrimary,isWorker,worker","extra":"same object true"} | online | exit 0',
  'never-listens: message {"had":true,"has":false,"isWorker":true,"id":"number","state":"online","same":true,"keys":"Worker,_events,_eventsCount,_getServer,_maxListeners,_setupWorker,isMaster,isPrimary,isWorker,worker","extra":"no listen"} | online | exit 0',
  "primary true false false SCHED_NONE,SCHED_RR,Worker,_events,_eventsCount,_maxListeners,disconnect,fork,isMaster,isPrimary,isWorker,schedulingPolicy,settings,setupMaster,setupPrimary,workers",
  'requires-cluster: message {"had":true,"has":false,"isWorker":true,"id":"number","state":"online","same":true,"keys":"Worker,_events,_eventsCount,_getServer,_maxListeners,_setupWorker,isMaster,isPrimary,isWorker,worker","extra":"before listen online"} | online | exit 0',
];

test("every kind of worker is set up once", async () => {
  const { stdout, stderr, exitCode } = await run([
    bunExe(),
    join(import.meta.dir, "worker-set-up-by-the-first-to-ask-fixture.js"),
  ]);
  expect({ lines: stdout.trimEnd().split("\n"), stderr, exitCode }).toEqual({
    lines: expected.filter(line => !isWindows || !line.startsWith("dgram-only: ")),
    stderr: "",
    exitCode: 0,
  });
});

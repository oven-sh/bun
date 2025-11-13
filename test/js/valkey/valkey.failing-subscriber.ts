// Program which sets up a subscriber outside the scope of the main Jest process.
// Used within valkey.test.ts.
//
// DO NOT IMPORT FROM test-utils.ts. That import is janky and will have different state at different from different
// importers.
import { RedisClient } from "bun";

function trySend(msg: any) {
  if (process === undefined || process.send === undefined) {
    throw new Error("process is undefined");
  }

  process.send(msg);
}

export interface RedisTestStartMessage {
  tlsPaths?: { cert: string; key: string; ca: string };
  url: string;
}
let redisUrlResolver: (msg: RedisTestStartMessage) => void;
const redisUrl = new Promise<RedisTestStartMessage>(resolve => {
  redisUrlResolver = resolve;
});

process.on("message", (msg: any) => {
  if (msg.event === "start") {
    redisUrlResolver(msg);
  } else {
    throw new Error("Unknown event " + msg.event);
  }
});

const CHANNEL = "error-callback-channel";

// We will wait for the parent process to tell us to start.
trySend({ event: "waiting-for-url" });
const { url, tlsPaths } = await redisUrl;
const subscriber = new RedisClient(url, {
  tls: tlsPaths
    ? {
        cert: Bun.file(tlsPaths.cert),
        key: Bun.file(tlsPaths.key),
        ca: Bun.file(tlsPaths.ca),
      }
    : undefined,
});
await subscriber.connect();

let counter = 0;
await subscriber.subscribe(CHANNEL, () => {
  if ((counter++) === 1) {
    throw new Error("Intentional callback error");
  }

  trySend({ event: "message", index: counter });
});

process.on("uncaughtException", e => {
  trySend({ event: "exception", exMsg: e.message });
});

trySend({ event: "ready" });

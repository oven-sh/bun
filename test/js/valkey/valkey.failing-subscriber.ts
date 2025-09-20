// Program which sets up a subscriber outside the scope of the main Jest process.
// Used within valkey.test.ts.
//
// DO NOT IMPORT FROM test-utils.ts. That import is janky and will have different state at different from different
// importers.
import {RedisClient} from "bun";

function trySend(msg: any) {
  if (process === undefined || process.send === undefined) {
    throw new Error("process is undefined");
  }

  process.send(msg);
}

let redisUrlResolver: (url: string) => void;
const redisUrl = new Promise<string>((resolve) => {
  redisUrlResolver = resolve;
});

process.on("message", (msg: any) => {
  if (msg.event === "start") {
    redisUrlResolver(msg.url);
  } else {
    throw new Error("Unknown event " + msg.event);
  }
});

const CHANNEL = "error-callback-channel";

// We will wait for the parent process to tell us to start.
const url = await redisUrl;
const subscriber = new RedisClient(url);
await subscriber.connect();
trySend({ event: "ready" });

let counter = 0;
await subscriber.subscribe(CHANNEL, () => {
  if ((counter++) === 1) {
    throw new Error("Intentional callback error");
  }

  trySend({ event: "message", index: counter });
});

process.on("uncaughtException", (e) => {
  trySend({ event: "exception", exMsg: e.message });
});

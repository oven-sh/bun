// Program which sets up a subscriber outside the scope of the main Jest process.
// Used within valkey.test.ts.
//
// DO NOT IMPORT FROM test-utils.ts. That import is janky and will have different state at different from different
// importers.
//
// These tests communicate over jsonb.
import { RedisClient } from "bun";

const CHANNEL = "error-callback-channel";

export interface Message {
  event: string;
}

export interface RunInfoMessage extends Message {
  event: "start";
  url: string;
  tlsPaths?: { cert: string; key: string; ca: string };
}

export interface ValkeyReceivedMessage extends Message {
  event: "message";
  index: number;
}

export interface ExceptionMessage extends Message {
  event: "exception";
  exMsg: string;
}

export interface ReadyMessage extends Message {
  event: "ready";
}

async function messageParent<MsgT extends Message>(msg: MsgT): Promise<void> {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function waitForParentMessage<MsgT extends Message>(expectedEvent: MsgT["event"]): Promise<MsgT> {
  for await (const line of console) {
    const parsed = JSON.parse(line);
    if (typeof(parsed) !== "object") {
      throw new Error("Expected object message");
    }

    if (parsed.event === undefined || typeof(parsed.event) !== "string") {
      throw new Error("Expected event field as a string");
    }

    if (parsed.event !== expectedEvent) {
      throw new Error(`Expected event ${expectedEvent} but got ${parsed.event}`);
    }

    return parsed as MsgT;
  }

  throw new Error("Input stream unexpectedly closed");
}

if (import.meta.main) {
  await messageParent({ event: "ready-for-url" });
  const runInfo = await waitForParentMessage<RunInfoMessage>("start");
  const subscriber = new RedisClient(runInfo.url, {
    tls: runInfo.tlsPaths
      ? {
          cert: Bun.file(runInfo.tlsPaths.cert),
          key: Bun.file(runInfo.tlsPaths.key),
          ca: Bun.file(runInfo.tlsPaths.ca),
        }
      : undefined,
  });
  await subscriber.connect();

  let counter = 0;
  await subscriber.subscribe(CHANNEL, () => {
    if ((counter++) === 1) {
      throw new Error("Intentional callback error");
    }

    messageParent<ValkeyReceivedMessage>({ event: "message", index: counter });
  });


  process.on("uncaughtException", e => {
    messageParent<ExceptionMessage>({ event: "exception", exMsg: e.message });
  });

  await messageParent({ event: "ready" });
}

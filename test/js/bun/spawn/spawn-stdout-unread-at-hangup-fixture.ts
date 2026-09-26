// Gives the stdout of a child to one consumer. The child hangs up with all of its bytes unread.
import { $ } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { positionDependentBytes } from "socketpair";

const [consumer, fifo, out, length] = process.argv.slice(2);
const cmd = [process.execPath, join(import.meta.dir, "spawn-stdout-unread-at-hangup-child-fixture.ts"), fifo, length];
let queued: number | undefined;
// The child queues its bytes only after this open, and reports only after it hung up. The read blocks this
// thread until then, so nothing polls the stdout socket before the hangup.
const untilChildHungUp = () => {
  queued = Number(readFileSync(fifo, "utf8"));
};

let received: Buffer;
if (consumer === "shell") {
  const captured = $`${cmd}`.quiet().arrayBuffer();
  setImmediate(untilChildHungUp);
  received = Buffer.from(await captured);
} else {
  const child = Bun.spawn({ cmd, stdin: "ignore", stdout: "pipe", stderr: "inherit" });
  if (consumer === "write" || consumer === "write-response") {
    const written = consumer === "write" ? Bun.write(out, child.stdout) : Bun.write(out, new Response(child.stdout));
    setImmediate(untilChildHungUp);
    await written;
    received = readFileSync(out);
  } else if (consumer === "rewriter") {
    const body = new HTMLRewriter().transform(new Response(child.stdout)).arrayBuffer();
    setImmediate(untilChildHungUp);
    received = Buffer.from(await body);
  } else if (consumer === "stdin") {
    const copier = Bun.spawn({
      cmd: [process.execPath, "-e", "await Bun.write(process.argv[1], Bun.stdin.stream());", out],
      stdin: child.stdout,
      stdout: "inherit",
      stderr: "inherit",
    });
    setImmediate(untilChildHungUp);
    await copier.exited;
    received = readFileSync(out);
  } else if (consumer === "fetch") {
    const chunks: Uint8Array[] = [];
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        for await (const chunk of req.body!) chunks.push(chunk);
        return new Response("ok");
      },
    });
    const response = fetch(server.url, { method: "POST", body: child.stdout });
    setImmediate(untilChildHungUp);
    await (await response).text();
    received = Buffer.concat(chunks);
  } else {
    throw new Error("unknown consumer: " + consumer);
  }
  await child.exited;
}
const intact = received.equals(positionDependentBytes(Number(length)));
console.log(JSON.stringify({ queued, received: received.length, intact }));

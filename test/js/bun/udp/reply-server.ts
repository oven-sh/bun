import { bunEnv, bunExe } from "harness";
import { createSocket } from "node:dgram";
import path from "node:path";

// Runs reply-server-fixture.ts. A client sends the server one datagram and
// closes its port while the server is held, so the answer of the server gets
// an ICMP error (port unreachable). Once the server answered that datagram, a
// second client asks for an echo. Settles when the echo is back, or when the
// server exits before that.
export async function replyServerAfterVanishedClient(api: "dgram" | "udpSocket", address = "127.0.0.1") {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "reply-server-fixture.ts"), api, address],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  // The next line the server printed, or undefined once its stdout closed.
  async function nextLine() {
    for (;;) {
      const end = buffered.indexOf("\n");
      if (end !== -1) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 1);
        return line;
      }
      const { value, done } = await stdout.read();
      if (done) return undefined;
      buffered += decoder.decode(value, { stream: true });
    }
  }

  const port = parseInt((await nextLine()) ?? "", 10);
  if (!(port > 0)) throw new Error(`the server printed no port\n${await proc.stderr.text()}`);

  const type = address.includes(":") ? "udp6" : "udp4";
  const vanished = createSocket(type);
  await new Promise<void>((resolve, reject) => {
    vanished.on("error", reject);
    vanished.send("gone", port, address, err => (err ? reject(err) : vanished.close(() => resolve())));
  });
  // The server reads only now: the datagram is queued and its sender is gone.
  proc.stdin.write("1");
  await proc.stdin.flush();
  const answeredVanished = (await nextLine()) === "answered";

  const client = createSocket(type);
  try {
    const received: string[] = [];
    const { promise: echoed, resolve, reject } = Promise.withResolvers<void>();
    client.on("error", reject);
    client.on("message", msg => {
      received.push(msg.toString());
      resolve();
    });
    client.send("ping", port, address);
    const exitedEarly = await Promise.race([echoed.then(() => false), proc.exited.then(() => true)]);
    if (!exitedEarly) client.send("close", port, address);
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { answeredVanished, received, exitedEarly, stderr, exitCode };
  } finally {
    client.close();
  }
}

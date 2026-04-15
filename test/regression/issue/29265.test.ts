import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("#29265 inspector exposes /json and /json/list for target discovery", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect=127.0.0.1:0", "-e", "setTimeout(() => {}, 60_000)"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const reader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let wsUrl: URL | undefined;
  while (!wsUrl) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const cleaned = buffered.replace(/\x1b\[[0-9;]*m/g, "");
    const match = cleaned.match(/(ws:\/\/[^\s]+)/);
    if (match) wsUrl = new URL(match[1]);
  }
  reader.releaseLock();
  if (!wsUrl) throw new Error("inspector did not print its URL:\n" + buffered);

  try {
    const base = `http://${wsUrl.host}`;

    for (const path of ["/json", "/json/list"] as const) {
      const res = await fetch(base + path);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<Record<string, unknown>>;
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
      const target = body[0];
      expect(typeof target.webSocketDebuggerUrl).toBe("string");
      expect(target.webSocketDebuggerUrl).toBe(`ws://${wsUrl.host}${wsUrl.pathname}`);
      expect(target.id).toBe(wsUrl.pathname.slice(1));
      expect(target.type).toBe("node");
    }

    // /json/version must still work and carry the expected shape.
    const versionRes = await fetch(base + "/json/version");
    expect(versionRes.status).toBe(200);
    const version = (await versionRes.json()) as Record<string, string>;
    expect(version["Protocol-Version"]).toBe("1.3");
    expect(version["Browser"]).toBe("Bun");
  } finally {
    proc.kill();
    await proc.exited;
  }
});

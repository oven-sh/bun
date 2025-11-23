import { expect, it } from "bun:test";
import { expiredTls, tls as validTls } from "harness";
const CERT_LOCALHOST_IP = { ...validTls };
const CERT_EXPIRED = { ...expiredTls };

for (const timeout of [0, 1, 10, 20, 100, 300]) {
  it.concurrent(`fetch should abort as soon as possible under tls using AbortSignal.timeout(${timeout})`, async () => {
    using server = Bun.serve({
      port: 0,
      tls: CERT_LOCALHOST_IP,
      async fetch() {
        await Bun.sleep(1000);
        return new Response("Hello World");
      },
    });
    const THRESHOLD = 50;

    const time = performance.now();
    try {
      await fetch(server.url, {
        //@ts-ignore
        tls: { ca: CERT_LOCALHOST_IP.cert },
        signal: AbortSignal.timeout(timeout),
      }).then(res => res.text());
      expect.unreachable();
    } catch (err) {
      expect((err as Error).name).toBe("TimeoutError");
    } finally {
      const diff = performance.now() - time;
      expect(diff).toBeLessThanOrEqual(timeout + THRESHOLD);
      expect(diff).toBeGreaterThanOrEqual(timeout - THRESHOLD);
    }
  });
}

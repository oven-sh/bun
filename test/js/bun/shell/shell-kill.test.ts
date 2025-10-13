import { $ } from "bun";
import { expect, test } from "bun:test";

test("kill() with default signal (SIGKILL)", async () => {
  const p = new $.Shell()`sleep 10`;
  p.kill();
  const r = await p;
  expect(r.exitCode).toBe(137); // 128 + 9
});

test("kill() with SIGTERM", async () => {
  const p = new $.Shell()`sleep 10`;
  p.kill(15);
  const r = await p;
  expect(r.exitCode).toBe(143); // 128 + 15
});

test("kill() before shell starts (lazy execution)", async () => {
  const p = new $.Shell()`sleep 10`;
  p.kill();
  const r = await p;
  expect(r.exitCode).toBe(137);
});

test("kill() after shell starts", async () => {
  const p = new $.Shell()`sleep 10`;
  const promise = p.then(r => r);
  await Bun.sleep(100);
  p.kill();
  const r = await promise;
  expect(r.exitCode).toBe(137);
});

test("kill() pipeline", async () => {
  const p = new $.Shell()`sleep 10 | sleep 10`;
  p.kill();
  const r = await p;
  expect(r.exitCode).toBe(137);
});

test("kill() multiple concurrent shells", async () => {
  const p1 = new $.Shell()`sleep 10`;
  const p2 = new $.Shell()`sleep 10`;
  const p3 = new $.Shell()`sleep 10`;

  p1.kill(9);
  p2.kill(15);
  p3.kill();

  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

  expect(r1.exitCode).toBe(137);
  expect(r2.exitCode).toBe(143);
  expect(r3.exitCode).toBe(137);
});

test("kill() with nothrow()", async () => {
  const p = new $.Shell()`sleep 10`.nothrow();
  p.kill();
  const r = await p;
  expect(r.exitCode).toBe(137);
});

test("kill() builtin command", async () => {
  const p = new $.Shell()`echo "test" && sleep 10`;
  p.kill();
  const r = await p;
  expect(r.exitCode).toBe(137);
});

test("kill() is idempotent", async () => {
  const p = new $.Shell()`sleep 10`;
  p.kill();
  p.kill();
  p.kill();
  const r = await p;
  expect(r.exitCode).toBe(137);
});

test("kill() with different signals", async () => {
  const signals = [9, 15, 2, 3];
  const promises = signals.map(async sig => {
    const p = new $.Shell()`sleep 10`;
    p.kill(sig);
    const r = await p;
    return { sig, exitCode: r.exitCode };
  });

  const results = await Promise.all(promises);

  for (const { sig, exitCode } of results) {
    expect(exitCode).toBe(128 + sig);
  }
});

// An object whose `ok` is a boolean computed at run time is returned from untyped code where a union
// discriminated by `ok: true | false` is declared. Each row has its own union, so that no row affects another.
import { later, pass } from "./untyped.js";

type R1 = { ok: true; status: number; d1: string } | { ok: false; status: number; d1: string };
async function f1(ok: boolean): Promise<R1> {
  return later({ ok, status: ok ? 200 : 500, d1: ok ? "body" : "reason" });
}
type R2 = { ok: true; status: number; d2: string } | { ok: false; status: number; d2: string };
async function f2(ok: boolean): Promise<R2> {
  return await later({ ok, status: ok ? 200 : 500, d2: ok ? "body" : "reason" });
}
type R3 = { ok: true; status: number; d3: string } | { ok: false; status: number; d3: string };
async function f3(ok: boolean): Promise<R3> {
  const result = await later({ ok, status: ok ? 200 : 500, d3: ok ? "body" : "reason" });
  return result;
}
type R4 = { ok: true; status: number; d4: string } | { ok: false; status: number; d4: string };
function f4(ok: boolean): Promise<R4> {
  return later({ ok, status: ok ? 200 : 500, d4: ok ? "body" : "reason" });
}
type R5 = { ok: true; status: number; d5: string } | { ok: false; status: number; d5: string };
const f5 = async (ok: boolean): Promise<R5> => later({ ok, status: ok ? 200 : 500, d5: ok ? "body" : "reason" });
type R6 = { ok: true; status: number; d6: string } | { ok: false; status: number; d6: string };
async function f6<T>(ok: boolean): Promise<T> {
  return later({ ok, status: ok ? 200 : 500, d6: ok ? "body" : "reason" });
}
type R7 = { ok: true; status: number; d7: string } | { ok: false; status: number; d7: string };
function f7(ok: boolean): Promise<R7> {
  return new Promise(resolve => {
    later({ ok, status: ok ? 200 : 500, d7: ok ? "body" : "reason" }).then(resolve);
  });
}
type R8 = { ok: true; status: number; d8: string } | { ok: false; status: number; d8: string };
class C8 {
  async get(ok: boolean): Promise<R8> {
    return later({ ok, status: ok ? 200 : 500, d8: ok ? "body" : "reason" });
  }
}
type R9 = { ok: true; status: number; d9: string } | { ok: false; status: number; d9: string };
async function f9(ok: boolean): Promise<R9> {
  return later({ ok, status: ok ? 200 : 500, d9: ok ? "body" : "reason" });
}
type R10 = { ok: true; status: number; d10: string } | { ok: false; status: number; d10: string };
async function f10(ok: boolean): Promise<R10[]> {
  return later([{ ok, status: ok ? 200 : 500, d10: ok ? "body" : "reason" }]);
}
type R11 = { ok: true; status: number; d11: string } | { ok: false; status: number; d11: string };
function f11(ok: boolean): R11 {
  return pass({ ok, status: ok ? 200 : 500, d11: ok ? "body" : "reason" });
}
type R12 = { ok: true; status: number; d12: string } | { ok: false; status: number; d12: string };
async function f12(ok: boolean): Promise<R12 | { ok: false; status: number; d12: string; retryAfter?: number }> {
  return later({ ok, status: ok ? 200 : 500, d12: ok ? "body" : "reason" });
}

type G = { ok: true; status: number; g: string } | { ok: false; status: number; g: string };
async function* each(): AsyncGenerator<G> {
  for (const ok of [true, false]) yield later({ ok, status: ok ? 200 : 500, g: ok ? "body" : "reason" });
}

for (const ok of [true, false]) {
  const r1 = await f1(ok);
  console.log("returns the promise:", r1.ok ? "ok" : "failed", r1.status, r1.d1);
  const r2 = await f2(ok);
  console.log("awaits first:", r2.ok ? "ok" : "failed", r2.status, r2.d2);
  const r3 = await f3(ok);
  console.log("through a local:", r3.ok ? "ok" : "failed", r3.status, r3.d3);
  const r4 = await f4(ok);
  console.log("not async:", r4.ok ? "ok" : "failed", r4.status, r4.d4);
  const r5 = await f5(ok);
  console.log("an arrow function:", r5.ok ? "ok" : "failed", r5.status, r5.d5);
  const r6 = await f6<R6>(ok);
  console.log("a type argument:", r6.ok ? "ok" : "failed", r6.status, r6.d6);
  const r7 = await f7(ok);
  console.log("a promise's resolve:", r7.ok ? "ok" : "failed", r7.status, r7.d7);
  const r8 = await new C8().get(ok);
  console.log("a method:", r8.ok ? "ok" : "failed", r8.status, r8.d8);
  const r9 = (await Promise.all([f9(ok)]))[0];
  console.log("Promise.all:", r9.ok ? "ok" : "failed", r9.status, r9.d9);
  const r10 = (await f10(ok))[0];
  console.log("in an array:", r10.ok ? "ok" : "failed", r10.status, r10.d10);
  const r11 = f11(ok);
  console.log("at once:", r11.ok ? "ok" : "failed", r11.status, r11.d11);
  const r12 = await f12(ok);
  console.log("an optional member in one part:", r12.ok ? "ok" : "failed", r12.status, r12.d12);
}
for await (const r of each()) console.log("an async generator:", r.ok ? "ok" : "failed", r.status, r.g);

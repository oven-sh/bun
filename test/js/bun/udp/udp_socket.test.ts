import { udpSocket } from "bun";
import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, disableAggressiveGCScope, isWindows, randomPort } from "harness";
import path from "node:path";
import { dataCases, dataTypes } from "./testdata";

describe("udpSocket()", () => {
  test.each(["setTTL", "setMulticastTTL"])(
    "%s does not crash when socket is closed during argument coercion",
    async method => {
      // coerceToInt32 on the argument can run user JS (valueOf), which may close
      // the socket before the native call. Previously this unwrapped a null
      // socket pointer and crashed; now it should throw "Socket is closed".
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const s = await Bun.udpSocket({});
          let err;
          try {
            s.${method}({ valueOf() { s.close(); return 1; } });
          } catch (e) {
            err = e;
          }
          if (!err) throw new Error("expected ${method} to throw");
          if (!String(err.message).includes("closed")) throw new Error("expected 'closed' error, got: " + err.message);
          console.log("OK");
        `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const stderr = rawStderr
        .split("\n")
        .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
        .join("\n");
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("OK");
      expect(exitCode).toBe(0);
    },
  );

  // `isString()` is `isStringLike()` and accepts boxed `new String(...)` /
  // `class extends String`, but `asString()` is a raw `static_cast<JSString*>`
  // that debug-asserts (and release type-confuses) on a StringObject cell.
  // Both send() and sendMany() must resolve via `toJSString()` instead.
  test("send/sendMany accept boxed String payloads without crashing", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const server = await Bun.udpSocket({ port: 0, hostname: "127.0.0.1" });
        const client = await Bun.udpSocket({ port: 0, hostname: "127.0.0.1" });
        class Derived extends String {}
        client.send(new String("a"), server.port, "127.0.0.1");
        client.send(new Derived("b"), server.port, "127.0.0.1");
        client.sendMany([new String("c"), server.port, "127.0.0.1", new Derived("d"), server.port, "127.0.0.1"]);
        client.close(); server.close();
        console.log("OK");
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const stderr = rawStderr
      .split("\n")
      .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
      .join("\n");
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  });

  test("connect with invalid hostname rejects", async () => {
    expect(async () =>
      udpSocket({
        connect: { hostname: "example!!!!!.com", port: 443 },
      }),
    ).toThrow();
  });

  // Out-of-range connect.port used to be silently rewritten to 0, so send()
  // returned true while every datagram was dropped. The bind path already
  // rejected the same values; connect must too.
  test.each([-1, 0, 65536, 99999, NaN, Infinity, "abc"] as const)(
    "connect with out-of-range port %p rejects",
    async port => {
      const result = udpSocket({ connect: { hostname: "127.0.0.1", port: port as number } });
      expect(result).toBeInstanceOf(Promise);
      await expect(result).rejects.toThrow('Expected "connect.port" to be an integer between 1 and 65535');
    },
  );

  // Bun.udpSocket() is typed as returning a Promise; bind/connect failures must
  // surface as promise rejections so `.catch()` / `.then(ok, err)` /
  // `Promise.allSettled` work. Previously these threw synchronously out of the
  // native call, bypassing any promise chain.
  describe("returns a rejected promise on failure instead of throwing synchronously", () => {
    test("EADDRINUSE", async () => {
      const holder = await udpSocket({ hostname: "127.0.0.1", socket: {} });
      try {
        let syncThrew = false;
        let result: any;
        try {
          result = udpSocket({ hostname: "127.0.0.1", port: holder.port, socket: {} });
        } catch {
          syncThrew = true;
        }
        expect(syncThrew).toBe(false);
        expect(result).toBeInstanceOf(Promise);
        const rejection = await result.then(
          (s: any) => {
            s.close();
            return null;
          },
          (e: any) => e,
        );
        expect(rejection).not.toBeNull();
        expect(rejection.syscall).toBe("bind");
        expect(rejection.code).toBe("EADDRINUSE");
        expect(rejection.address).toBe("127.0.0.1");
      } finally {
        holder.close();
      }
    });

    test("EADDRINUSE is catchable via .catch()", async () => {
      const holder = await udpSocket({ hostname: "127.0.0.1", socket: {} });
      try {
        // The fallback-port resilience pattern that motivated this fix.
        const socket = await udpSocket({ hostname: "127.0.0.1", port: holder.port, socket: {} }).catch(() =>
          udpSocket({ hostname: "127.0.0.1", port: 0, socket: {} }),
        );
        try {
          expect(socket.port).toBeInteger();
          expect(socket.port).not.toBe(holder.port);
        } finally {
          socket.close();
        }
      } finally {
        holder.close();
      }
    });

    test("EADDRNOTAVAIL", async () => {
      let syncThrew = false;
      let result: any;
      try {
        // 192.0.2.0/24 (TEST-NET-1) is guaranteed non-local.
        result = udpSocket({ hostname: "192.0.2.1", port: 0, socket: {} });
      } catch {
        syncThrew = true;
      }
      expect(syncThrew).toBe(false);
      expect(result).toBeInstanceOf(Promise);
      const rejection = await result.then(
        (s: any) => {
          s.close();
          return null;
        },
        (e: any) => e,
      );
      expect(rejection).not.toBeNull();
      expect(rejection.syscall).toBe("bind");
      expect(rejection.code).toBe("EADDRNOTAVAIL");
    });

    test("invalid options", async () => {
      let syncThrew = false;
      let result: any;
      try {
        result = udpSocket({ port: -1 } as any);
      } catch {
        syncThrew = true;
      }
      // Attach a handler immediately so the rejected promise is observed.
      const rejection = await result?.then(
        (s: any) => {
          s.close();
          return null;
        },
        (e: any) => e,
      );
      expect(syncThrew).toBe(false);
      expect(result).toBeInstanceOf(Promise);
      expect(rejection?.code).toBe("ERR_INVALID_ARG_TYPE");
    });

    test("Promise.allSettled over a port range", async () => {
      const holder = await udpSocket({ hostname: "127.0.0.1", socket: {} });
      try {
        const results = await Promise.allSettled([
          udpSocket({ hostname: "127.0.0.1", port: holder.port, socket: {} }),
          udpSocket({ hostname: "127.0.0.1", port: 0, socket: {} }),
        ]);
        try {
          expect(results[0].status).toBe("rejected");
          expect((results[0] as PromiseRejectedResult).reason.code).toBe("EADDRINUSE");
          expect(results[1].status).toBe("fulfilled");
        } finally {
          for (const r of results) if (r.status === "fulfilled") r.value.close();
        }
      } finally {
        holder.close();
      }
    });
  });

  test("connect with valid port at range boundaries is accepted", async () => {
    for (const port of [1, 65535]) {
      const socket = await udpSocket({ connect: { hostname: "127.0.0.1", port } });
      try {
        expect(socket.remoteAddress).toEqual({ address: "127.0.0.1", family: "IPv4", port });
      } finally {
        socket.close();
      }
    }
  });

  // The Strong ref on the JS wrapper used to be left in place when udpSocket()
  // threw before the underlying uws socket was created (invalid options, bind
  // failure), pinning the wrapper forever and leaking the Zig struct.
  describe("does not leak UDPSocket wrapper when creation fails", () => {
    async function countUDPSocketsAfterGC(max: number) {
      // Conservative stack scanning may keep the most-recently-created
      // wrapper alive for a bit, so stop once we're at or below `max`
      // instead of waiting forever for exactly zero.
      for (let i = 0; i < 20; i++) {
        Bun.gc(true);
        const count = heapStats().objectTypeCounts.UDPSocket || 0;
        if (count <= max) return count;
        await Bun.sleep(5);
      }
      Bun.gc(true);
      return heapStats().objectTypeCounts.UDPSocket || 0;
    }

    test.each([
      ["config validation throws", { port: -1 }],
      [
        "user getter throws",
        {
          get port() {
            throw new Error("nope");
          },
        },
      ],
      // Use a hostname with invalid label characters so getaddrinfo rejects
      // it locally (no DNS round-trip). "256.256.256.256" would work too but
      // is valid DNS syntax and triggers a real resolver query per iteration.
      ["bind fails", { hostname: "example!!!!!.com", port: 0 }],
    ] as const)("%s", async (_, options) => {
      const iterations = 200;
      let thrown = 0;
      for (let i = 0; i < iterations; i++) {
        try {
          await udpSocket(options as any);
        } catch {
          thrown++;
        }
      }
      expect(thrown).toBe(iterations);

      // Allow a tiny amount of slack for GC timing, but nowhere near `iterations`.
      // Before the fix this equaled `iterations` (every wrapper leaked).
      const remaining = await countUDPSocketsAfterGC(5);
      expect(remaining).toBeLessThan(10);
      expect(heapStats().protectedObjectTypeCounts.UDPSocket || 0).toBe(0);
    });
  });

  test("can create a socket", async () => {
    const socket = await udpSocket({});
    expect(socket).toBeInstanceOf(Object);
    expect(socket.port).toBeInteger();
    expect(socket.port).toBeWithin(1, 65535 + 1);
    expect(socket.port).toBe(socket.port); // test that property is cached
    expect(socket.hostname).toBeString();
    expect(socket.hostname).toBe(socket.hostname); // test that property is cached
    expect(socket.address).toMatchObject({
      address: socket.hostname,
      family: socket.hostname === "::" ? "IPv6" : "IPv4",
      port: socket.port,
    });
    expect(socket.address).toBe(socket.address); // test that property is cached
    expect(socket.binaryType).toBe("buffer");
    expect(socket.binaryType).toBe(socket.binaryType); // test that property is cached
    expect(socket.ref).toBeFunction();
    expect(socket.unref).toBeFunction();
    expect(socket.send).toBeFunction();
    expect(socket.close).toBeFunction();
    socket.close();
  });

  test("can create a socket with given port", async () => {
    for (let i = 0; i < 30; i++) {
      const port = randomPort();
      try {
        const socket = await udpSocket({ port });
        expect(socket.port).toBe(port);
        expect(socket.address).toMatchObject({ port: socket.port });
        socket.close();
        break;
      } catch (e) {
        continue;
      }
    }
  });

  test("can create a socket with a random port", async () => {
    const socket = await udpSocket({ port: 0 });
    expect(socket.port).toBeInteger();
    expect(socket.port).toBeWithin(1, 65535 + 1);
    expect(socket.address).toMatchObject({ port: socket.port });
    socket.close();
  });

  describe.each([{ hostname: "localhost" }, { hostname: "127.0.0.1" }, { hostname: "::1" }])(
    "can create a socket with given hostname",
    ({ hostname }) => {
      test(hostname, async () => {
        const socket = await udpSocket({ hostname });
        expect(socket.hostname).toBe(hostname);
        expect(socket.port).toBeInteger();
        expect(socket.port).toBeWithin(1, 65535 + 1);
        expect(socket.address).toMatchObject({ port: socket.port });
        socket.close();
      });
    },
  );

  const validateRecv = (socket, data, port, address, binaryType, bytes) => {
    // This test file takes 1 minute in CI because we are running GC too much.
    using _ = disableAggressiveGCScope();

    expect(socket).toBeInstanceOf(Object);
    expect(socket.binaryType).toBe(binaryType || "buffer");
    expect(data.byteLength).toBe(bytes.byteLength);
    expect(data).toBeBinaryType(binaryType || "buffer");
    expect(data).toEqual(bytes);
    expect(port).toBeInteger();
    expect(port).toBeWithin(1, 65535 + 1);
    expect(port).not.toBe(socket.port);
    expect(address).toBeString();
    expect(address).not.toBeEmpty();
  };

  const validateSend = res => {
    // This test file takes 1 minute in CI because we are running GC too much.
    using _ = disableAggressiveGCScope();

    expect(res).toBeBoolean();
  };

  const validateSendMany = (res, count) => {
    // This test file takes 1 minute in CI because we are running GC too much.
    using _ = disableAggressiveGCScope();

    expect(res).toBeNumber();
    expect(res).toBeGreaterThanOrEqual(0);
    expect(res).toBeLessThanOrEqual(count);
  };

  for (const { binaryType, type } of dataTypes) {
    for (let { label, data, bytes } of dataCases) {
      if (type === ArrayBuffer) {
        bytes = new Uint8Array(bytes).buffer;
      }

      test(`send ${label} (${binaryType || "undefined"})`, async done => {
        const client = await udpSocket({});
        const server = await udpSocket({
          binaryType: binaryType,
          socket: {
            data(socket, data, port, address) {
              validateRecv(socket, data, port, address, binaryType, bytes);

              server.close();
              client.close();
              done();
            },
          },
        });

        // handle unreliable transmission in UDP
        function sendRec() {
          if (!client.closed) {
            validateSend(client.send(data, server.port, "127.0.0.1"));
            setTimeout(sendRec, 10);
          }
        }
        sendRec();
      });

      test(`send connected ${label} (${binaryType || "undefined"})`, async done => {
        let client;
        const server = await udpSocket({
          binaryType: binaryType,
          socket: {
            data(socket, data, port, address) {
              validateRecv(socket, data, port, address, binaryType, bytes);

              server.close();
              client.close();
              done();
            },
          },
        });
        client = await udpSocket({
          connect: {
            port: server.port,
            hostname: "127.0.0.1",
          },
        });

        // handle unreliable transmission in UDP
        function sendRec() {
          if (!client.closed) {
            validateSend(client.send(data));
            setTimeout(sendRec, 10);
          }
        }
        sendRec();
      });

      test(`sendMany ${label} (${binaryType || "undefined"})`, async done => {
        const client = await udpSocket({});
        let count = 0;
        const server = await udpSocket({
          binaryType: binaryType,
          socket: {
            data(socket, data, port, address) {
              validateRecv(socket, data, port, address, binaryType, bytes);

              count += 1;
              if (count === 100) {
                server.close();
                client.close();
                done();
              }
            },
          },
        });

        const payload = Array(100).fill([data, server.port, "127.0.0.1"]).flat();

        // handle unreliable transmission in UDP
        function sendRec() {
          if (!client.closed) {
            validateSendMany(client.sendMany(payload), 100);
            setTimeout(sendRec, 10);
          }
        }
        sendRec();
      });

      test(`sendMany connected ${label} (${binaryType || "undefined"})`, async done => {
        // const client = await udpSocket({});
        let client;
        let count = 0;
        const server = await udpSocket({
          binaryType: binaryType,
          socket: {
            data(socket, data, port, address) {
              validateRecv(socket, data, port, address, binaryType, bytes);

              count += 1;
              if (count === 100) {
                server.close();
                client.close();
                done();
              }
            },
          },
        });

        client = await udpSocket({
          connect: {
            port: server.port,
            hostname: "127.0.0.1",
          },
        });

        const payload = Array(100).fill(data);

        // handle unreliable transmission in UDP
        function sendRec() {
          if (!client.closed) {
            validateSendMany(client.sendMany(payload), 100);
            setTimeout(sendRec, 10);
          }
        }
        sendRec();
      });
    }
  }

  // send()/sendMany() capture a pointer into the payload's backing store and
  // then run user JS (port `valueOf()`, address `toString()`, and for
  // sendMany also array index getters on later iterations). That JS can
  // detach the ArrayBuffer via `transfer(n)` and free the bytes before the
  // native send path reads them. sendMany roots each payload JSValue in a
  // MarkedArgumentBuffer and defers borrowing byte slices until after all
  // user JS has run; send resolves the destination before capturing the
  // payload.
  describe("detaching an ArrayBuffer during port/address coercion does not use-after-free", () => {
    for (const mode of ["sendMany", "sendMany-stringobj", "send"] as const) {
      test(
        mode,
        async () => {
          await using proc = Bun.spawn({
            cmd: [bunExe(), path.join(import.meta.dir, "sendMany-payload-uaf-fixture.ts"), mode],
            env: {
              ...bunEnv,
              // Route bmalloc through the system heap so ASAN can observe the
              // ArrayBuffer backing-store free in sanitizer-enabled builds. On
              // Windows bmalloc's SystemHeap is unimplemented and would
              // RELEASE_BASSERT, so leave bmalloc in place there — Windows has
              // no ASAN lane anyway, and the fixture still checks correctness.
              ...(isWindows ? {} : { Malloc: "1" }),
            },
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, rawStderr, exitCode] = await Promise.all([
            proc.stdout.text(),
            proc.stderr.text(),
            proc.exited,
          ]);
          const stderr = rawStderr
            .split("\n")
            .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
            .join("\n");
          expect(stderr).toBe("");
          expect(stdout).toBe("OK\n");
          expect(exitCode).toBe(0);
        },
        30_000,
      );
    }
  });

  // The on_data callback receives a recvmmsg batch and iterates it. If the
  // user's data handler closes the socket, the remaining packets in that
  // batch must not be dispatched — matches libuv's per-datagram handle
  // recheck (node:dgram relies on this for close() semantics).
  test("close() from inside the data handler stops the rest of the recvmmsg batch", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const trace = [];
        const server = await Bun.udpSocket({
          port: 0,
          hostname: "127.0.0.1",
          socket: {
            data(socket, buf) {
              trace.push("data:" + socket.closed);
              if (trace.length === 1) socket.close();
            },
          },
        });
        const client = await Bun.udpSocket({ port: 0, hostname: "127.0.0.1" });
        const payload = [];
        for (let i = 0; i < 32; i++) payload.push("x", server.port, "127.0.0.1");
        // One sendmmsg syscall: on loopback the whole burst lands in the
        // kernel recv queue before the event loop polls, so recvmmsg yields a
        // multi-packet batch and on_data iterates more than once.
        client.sendMany(payload);
        // Let the event loop drain any additional recvmmsg rounds.
        for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r));
        client.close();
        console.log(JSON.stringify(trace));
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const stderr = rawStderr
      .split("\n")
      .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
      .join("\n");
    expect(stderr).toBe("");
    // Exactly one data event, observed while the socket was still open.
    expect(stdout.trim()).toBe('["data:false"]');
    expect(exitCode).toBe(0);
  });

  // sendMany() iterates the input array and may run user JS (array index
  // getters, port `valueOf()`, address `toString()`). That user JS can
  // connect or disconnect the socket; sendMany must snapshot the connection
  // state up front so the arena buffer indexing cannot change mid-loop.
  describe("sendMany does not crash when the connection state changes during iteration", () => {
    for (const direction of ["connect", "disconnect"] as const) {
      test(
        direction,
        async () => {
          await using proc = Bun.spawn({
            cmd: [bunExe(), path.join(import.meta.dir, "sendMany-reentrancy-fixture.ts"), direction],
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, rawStderr, exitCode] = await Promise.all([
            proc.stdout.text(),
            proc.stderr.text(),
            proc.exited,
          ]);
          const stderr = rawStderr
            .split("\n")
            .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
            .join("\n");
          expect(stderr).toBe("");
          expect(stdout).toBe("OK\n");
          expect(exitCode).toBe(0);
        },
        30_000,
      );
    }
  });

  // binaryType accepts every typed-array constructor name, not just the three
  // listed in the error message. Before the JSC C-API path was removed,
  // "float16array" fell through to kJSTypedArrayTypeNone and segfaulted
  // dereferencing the null result; spawn a subprocess so that crash is caught
  // as a non-zero exit instead of taking the runner down.
  describe.each([
    ["int8array", "Int8Array", 8],
    ["int16array", "Int16Array", 4],
    ["uint16array", "Uint16Array", 4],
    ["int32array", "Int32Array", 2],
    ["uint32array", "Uint32Array", 2],
    ["float16array", "Float16Array", 4],
    ["float32array", "Float32Array", 2],
    ["float64array", "Float64Array", 1],
  ] as const)("binaryType delivers a typed array of the requested kind", (binaryType, ctorName, expectedLen) => {
    test(
      binaryType,
      async () => {
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `
              const { promise, resolve, reject } = Promise.withResolvers();
              const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
              const server = await Bun.udpSocket({
                binaryType: ${JSON.stringify(binaryType)},
                socket: {
                  data(socket, data) {
                    resolve({
                      ctor: data?.constructor?.name ?? String(data),
                      byteLength: data?.byteLength,
                      length: data?.length,
                      bytes: data == null ? null : [...new Uint8Array(data.buffer, data.byteOffset, data.byteLength)],
                    });
                  },
                  error(socket, err) { reject(err); },
                },
              });
              const client = await Bun.udpSocket({});
              const retry = setInterval(() => client.send(payload, server.port, "127.0.0.1"), 20);
              client.send(payload, server.port, "127.0.0.1");
              const result = await promise;
              clearInterval(retry);
              server.close();
              client.close();
              console.log(JSON.stringify(result));
            `,
          ],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const stderr = rawStderr
          .split("\n")
          .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
          .join("\n");
        expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
          stdout: JSON.stringify({
            ctor: ctorName,
            byteLength: 8,
            length: expectedLen,
            bytes: [1, 2, 3, 4, 5, 6, 7, 8],
          }),
          stderr: "",
          exitCode: 0,
        });
      },
      30_000,
    );
  });
});

// us_udp_socket_send batches at most ~204 messages per sendmmsg; a >batch-size
// sendMany must loop and report the TOTAL accepted. The pre-fix loop condition
// compared against a decremented `num` and stopped after one batch, which every
// <=100-packet test above still satisfies.
test("sendMany() sends every packet of a larger-than-one-batch call", async () => {
  const server = await udpSocket({ socket: { data() {} } });
  const client = await udpSocket({ connect: { port: server.port, hostname: "127.0.0.1" } });
  try {
    const N = 500;
    const payloads = new Array(N);
    for (let i = 0; i < N; i++) payloads[i] = "x";
    // The regression this guards: the old loop exited after ONE batch, so a
    // 500-packet call reported <=~204. Assert "more than one batch" rather
    // than the exact count -- a loaded kernel may legitimately accept fewer
    // than all 500.
    const res = client.sendMany(payloads);
    expect(res).toBeGreaterThan(204);
    expect(res).toBeLessThanOrEqual(N);
  } finally {
    client.close();
    server.close();
  }
});

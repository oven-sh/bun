// @known-failing-on-windows: 1 failing
import { file, gc, Serve, serve, Server } from "bun";
import { afterEach, describe, it, expect, afterAll } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { bunExe, bunEnv, dumpStats } from "harness";
// import { renderToReadableStream } from "react-dom/server";
// import app_jsx from "./app.jsx";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { heapStats } from "bun:jsc";

let renderToReadableStream: any = null;
let app_jsx: any = null;

type Handler = (req: Request) => Response;
afterEach(() => {
  gc(true);
});
for (const [label, tlsEnabled] of [
  ["https:", true],
  ["http:", false],
]) {
  describe(label, () => {
    const count = 200;
    let server: Server | undefined;

    const fetch = tlsEnabled
      ? function fetch(...args) {
          args[1] ||= {};
          args[1].tls ||= {};
          args[1].tls.rejectUnauthorized = false;
          return Bun.fetch(args[0], args[1]);
        }
      : globalThis.fetch;

    const sharedOptions = tlsEnabled
      ? {
          tls: {
            cert: "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAKLdQVPy90jjMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV\nBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX\naWRnaXRzIFB0eSBMdGQwHhcNMTkwMjAzMTQ0OTM1WhcNMjAwMjAzMTQ0OTM1WjBF\nMQswCQYDVQQGEwJBVTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UECgwYSW50\nZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB\nCgKCAQEA7i7IIEdICTiSTVx+ma6xHxOtcbd6wGW3nkxlCkJ1UuV8NmY5ovMsGnGD\nhJJtUQ2j5ig5BcJUf3tezqCNW4tKnSOgSISfEAKvpn2BPvaFq3yx2Yjz0ruvcGKp\nDMZBXmB/AAtGyN/UFXzkrcfppmLHJTaBYGG6KnmU43gPkSDy4iw46CJFUOupc51A\nFIz7RsE7mbT1plCM8e75gfqaZSn2k+Wmy+8n1HGyYHhVISRVvPqkS7gVLSVEdTea\nUtKP1Vx/818/HDWk3oIvDVWI9CFH73elNxBkMH5zArSNIBTehdnehyAevjY4RaC/\nkK8rslO3e4EtJ9SnA4swOjCiqAIQEwIDAQABo1AwTjAdBgNVHQ4EFgQUv5rc9Smm\n9c4YnNf3hR49t4rH4yswHwYDVR0jBBgwFoAUv5rc9Smm9c4YnNf3hR49t4rH4ysw\nDAYDVR0TBAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEATcL9CAAXg0u//eYUAlQa\nL+l8yKHS1rsq1sdmx7pvsmfZ2g8ONQGfSF3TkzkI2OOnCBokeqAYuyT8awfdNUtE\nEHOihv4ZzhK2YZVuy0fHX2d4cCFeQpdxno7aN6B37qtsLIRZxkD8PU60Dfu9ea5F\nDDynnD0TUabna6a0iGn77yD8GPhjaJMOz3gMYjQFqsKL252isDVHEDbpVxIzxPmN\nw1+WK8zRNdunAcHikeoKCuAPvlZ83gDQHp07dYdbuZvHwGj0nfxBLc9qt90XsBtC\n4IYR7c/bcLMmKXYf0qoQ4OzngsnPI5M+v9QEHvYWaKVwFY4CTcSNJEwfXw+BAeO5\nOA==\n-----END CERTIFICATE-----",
            key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDuLsggR0gJOJJN\nXH6ZrrEfE61xt3rAZbeeTGUKQnVS5Xw2Zjmi8ywacYOEkm1RDaPmKDkFwlR/e17O\noI1bi0qdI6BIhJ8QAq+mfYE+9oWrfLHZiPPSu69wYqkMxkFeYH8AC0bI39QVfOSt\nx+mmYsclNoFgYboqeZTjeA+RIPLiLDjoIkVQ66lznUAUjPtGwTuZtPWmUIzx7vmB\n+pplKfaT5abL7yfUcbJgeFUhJFW8+qRLuBUtJUR1N5pS0o/VXH/zXz8cNaTegi8N\nVYj0IUfvd6U3EGQwfnMCtI0gFN6F2d6HIB6+NjhFoL+QryuyU7d7gS0n1KcDizA6\nMKKoAhATAgMBAAECggEAd5g/3o1MK20fcP7PhsVDpHIR9faGCVNJto9vcI5cMMqP\n6xS7PgnSDFkRC6EmiLtLn8Z0k2K3YOeGfEP7lorDZVG9KoyE/doLbpK4MfBAwBG1\nj6AHpbmd5tVzQrnNmuDjBBelbDmPWVbD0EqAFI6mphXPMqD/hFJWIz1mu52Kt2s6\n++MkdqLO0ORDNhKmzu6SADQEcJ9Suhcmv8nccMmwCsIQAUrfg3qOyqU4//8QB8ZM\njosO3gMUesihVeuF5XpptFjrAliPgw9uIG0aQkhVbf/17qy0XRi8dkqXj3efxEDp\n1LSqZjBFiqJlFchbz19clwavMF/FhxHpKIhhmkkRSQKBgQD9blaWSg/2AGNhRfpX\nYq+6yKUkUD4jL7pmX1BVca6dXqILWtHl2afWeUorgv2QaK1/MJDH9Gz9Gu58hJb3\nymdeAISwPyHp8euyLIfiXSAi+ibKXkxkl1KQSweBM2oucnLsNne6Iv6QmXPpXtro\nnTMoGQDS7HVRy1on5NQLMPbUBQKBgQDwmN+um8F3CW6ZV1ZljJm7BFAgNyJ7m/5Q\nYUcOO5rFbNsHexStrx/h8jYnpdpIVlxACjh1xIyJ3lOCSAWfBWCS6KpgeO1Y484k\nEYhGjoUsKNQia8UWVt+uWnwjVSDhQjy5/pSH9xyFrUfDg8JnSlhsy0oC0C/PBjxn\nhxmADSLnNwKBgQD2A51USVMTKC9Q50BsgeU6+bmt9aNMPvHAnPf76d5q78l4IlKt\nwMs33QgOExuYirUZSgjRwknmrbUi9QckRbxwOSqVeMOwOWLm1GmYaXRf39u2CTI5\nV9gTMHJ5jnKd4gYDnaA99eiOcBhgS+9PbgKSAyuUlWwR2ciL/4uDzaVeDQKBgDym\nvRSeTRn99bSQMMZuuD5N6wkD/RxeCbEnpKrw2aZVN63eGCtkj0v9LCu4gptjseOu\n7+a4Qplqw3B/SXN5/otqPbEOKv8Shl/PT6RBv06PiFKZClkEU2T3iH27sws2EGru\nw3C3GaiVMxcVewdg1YOvh5vH8ZVlxApxIzuFlDvnAoGAN5w+gukxd5QnP/7hcLDZ\nF+vesAykJX71AuqFXB4Wh/qFY92CSm7ImexWA/L9z461+NKeJwb64Nc53z59oA10\n/3o2OcIe44kddZXQVP6KTZBd7ySVhbtOiK3/pCy+BQRsrC7d71W914DxNWadwZ+a\njtwwKjDzmPwdIXDSQarCx0U=\n-----END PRIVATE KEY-----",
            passphrase: "1234",
          },
          port: 0,
        }
      : { port: 0 };

    async function runTest({ port, ...serverOptions }: Serve<any>, test: (server: Server) => Promise<void> | void) {
      if (server) {
        server.reload({ ...serverOptions, ...sharedOptions });
      } else {
        while (!server) {
          try {
            server = serve({ ...serverOptions, ...sharedOptions });
            console.log(`Server: ${server.url}`);
            break;
          } catch (e: any) {
            console.log("catch:", e);
            if (e?.message !== `Failed to start server `) {
              throw e;
            }
          }
        }
      }

      await test(server);
    }

    afterAll(() => {
      if (server) {
        server.stop(true);
        server = undefined;
      }
    });

    describe("1000 simultaneous uploads & downloads do not leak ReadableStream", () => {
      for (let isDirect of [true, false] as const) {
        it(
          isDirect ? "direct" : "default",
          async () => {
            const blob = new Blob([new Uint8Array(1024 * 768).fill(123)]);
            Bun.gc(true);

            const expected = Bun.CryptoHasher.hash("sha256", blob, "base64");
            const initialCount = heapStats().objectTypeCounts.ReadableStream || 0;

            await runTest(
              {
                async fetch(req) {
                  var hasher = new Bun.SHA256();
                  for await (const chunk of req.body) {
                    await Bun.sleep(0);
                    hasher.update(chunk);
                  }
                  return new Response(
                    isDirect
                      ? new ReadableStream({
                          type: "direct",
                          async pull(controller) {
                            await Bun.sleep(0);
                            controller.write(Buffer.from(hasher.digest("base64")));
                            await controller.flush();
                            controller.close();
                          },
                        })
                      : new ReadableStream({
                          async pull(controller) {
                            await Bun.sleep(0);
                            controller.enqueue(Buffer.from(hasher.digest("base64")));
                            controller.close();
                          },
                        }),
                  );
                },
              },
              async server => {
                const count = 1000;
                async function callback() {
                  const response = await fetch(server.url, { body: blob, method: "POST" });

                  // We are testing for ReadableStream leaks, so we use the ReadableStream here.
                  const chunks = [];
                  for await (const chunk of response.body) {
                    chunks.push(chunk);
                  }

                  const digest = Buffer.from(Bun.concatArrayBuffers(chunks)).toString();

                  expect(digest).toBe(expected);
                  Bun.gc(false);
                }
                {
                  const promises = new Array(count);
                  for (let i = 0; i < count; i++) {
                    promises[i] = callback();
                  }

                  await Promise.all(promises);
                }

                Bun.gc(true);
                dumpStats();
                expect(heapStats().objectTypeCounts.ReadableStream).toBeWithin(
                  Math.max(initialCount - count / 2, 0),
                  initialCount + count / 2,
                );
              },
            );
          },
          100000,
        );
      }
    });

    [200, 200n, 303, 418, 599, 599n].forEach(statusCode => {
      it(`should response with HTTP status code (${statusCode})`, async () => {
        await runTest(
          {
            fetch() {
              return new Response("Foo Bar", { status: statusCode });
            },
          },
          async server => {
            const response = await fetch(server.url.origin);
            expect(response.status).toBe(Number(statusCode));
            expect(await response.text()).toBe("Foo Bar");
          },
        );
      });
    });

    [-200, 42, 100, 102, 12345, Math.PI, 999, 600, 199, 199n, 600n, 100n, 102n].forEach(statusCode => {
      it(`should error on invalid HTTP status code (${statusCode})`, async () => {
        await runTest(
          {
            fetch() {
              try {
                return new Response("Foo Bar", { status: statusCode });
              } catch (err) {
                expect(err).toBeInstanceOf(RangeError);
                return new Response("Error!", { status: 500 });
              }
            },
          },
          async server => {
            const response = await fetch(server.url.origin);
            expect(response.status).toBe(500);
            expect(await response.text()).toBe("Error!");
          },
        );
      });
    });

    it("should display a welcome message when the response value type is incorrect", async () => {
      await runTest(
        {
          // @ts-ignore
          fetch(req) {
            return Symbol("invalid response type");
          },
        },
        async server => {
          const response = await fetch(server.url.origin);
          const text = await response.text();
          expect(text).toContain("Welcome to Bun!");
        },
      );
    });

    it("request.signal works in trivial case", async () => {
      var aborty = new AbortController();
      var didAbort = false;
      await runTest(
        {
          async fetch(req) {
            req.signal.addEventListener("abort", () => {
              didAbort = true;
            });
            expect(didAbort).toBe(false);
            aborty.abort();
            await Bun.sleep(2);
            return new Response("Test failed!");
          },
        },
        async server => {
          try {
            await fetch(server.url.origin, { signal: aborty.signal });
            throw new Error("Expected fetch to throw");
          } catch (e: any) {
            expect(e.name).toBe("AbortError");
          }
          await Bun.sleep(1);

          expect(didAbort).toBe(true);
        },
      );
    });

    it("request.signal works in leaky case", async () => {
      var aborty = new AbortController();
      var didAbort = false;

      await runTest(
        {
          async fetch(req) {
            req.signal.addEventListener("abort", () => {
              didAbort = true;
            });

            expect(didAbort).toBe(false);
            aborty.abort();
            await Bun.sleep(20);
            return new Response("Test failed!");
          },
        },
        async server => {
          expect(async () => fetch(server.url.origin, { signal: aborty.signal })).toThrow("The operation was aborted.");

          await Bun.sleep(10);

          expect(didAbort).toBe(true);
        },
      );
    });

    it("should work for a file", async () => {
      const fixture = resolve(import.meta.dir, "./fetch.js.txt");
      const textToExpect = readFileSync(fixture, "utf-8");
      await runTest(
        {
          fetch(req) {
            return new Response(file(fixture));
          },
        },
        async server => {
          const response = await fetch(server.url.origin);
          expect(await response.text()).toBe(textToExpect);
        },
      );
    });

    it("request.url should log successfully", async () => {
      const fixture = resolve(import.meta.dir, "./fetch.js.txt");
      const textToExpect = readFileSync(fixture, "utf-8");
      var expected: string;
      await runTest(
        {
          fetch(req) {
            expect(Bun.inspect(req).includes(expected)).toBe(true);
            return new Response(file(fixture));
          },
        },
        async server => {
          expected = `http://localhost:${server.port}/helloooo`;
          const response = await fetch(expected);
          expect(response.url).toBe(expected);
          expect(await response.text()).toBe(textToExpect);
        },
      );
    });

    it("request.url should be based on the Host header", async () => {
      const fixture = resolve(import.meta.dir, "./fetch.js.txt");
      const textToExpect = readFileSync(fixture, "utf-8");
      await runTest(
        {
          fetch(req) {
            expect(req.url).toBe("http://example.com/helloooo");
            return new Response(file(fixture));
          },
        },
        async server => {
          const expected = `${server.url.origin}/helloooo`;
          const response = await fetch(expected, {
            headers: {
              Host: "example.com",
            },
          });
          expect(response.url).toBe(expected);
          expect(await response.text()).toBe(textToExpect);
        },
      );
    });

    describe("streaming", () => {
      describe("error handler", () => {
        it("throw on pull renders headers, does not call error handler", async () => {
          var pass = true;
          await runTest(
            {
              error(e) {
                pass = false;
                return new Response("FAIL!", { status: 555 });
              },
              fetch(req) {
                return new Response(
                  new ReadableStream({
                    pull(controller) {
                      throw new Error("TestPassed");
                    },
                    cancel(reason) {},
                  }),
                  {
                    status: 402,
                    headers: {
                      "I-AM": "A-TEAPOT",
                    },
                  },
                );
              },
            },
            async server => {
              const response = await fetch(server.url.origin);
              expect(response.status).toBe(402);
              expect(response.headers.get("I-AM")).toBe("A-TEAPOT");
              expect(await response.text()).toBe("");
              expect(pass).toBe(true);
            },
          );
        });

        describe("throw on pull after writing should not call the error handler", () => {
          async function execute(options: ResponseInit) {
            var pass = true;
            await runTest(
              {
                error(e) {
                  pass = false;
                  return new Response("FAIL", { status: 555 });
                },
                fetch(req) {
                  const stream = new ReadableStream({
                    async pull(controller) {
                      controller.enqueue("PASS");
                      controller.close();
                      throw new Error("FAIL");
                    },
                  });
                  const r = new Response(stream, options);
                  return r;
                },
              },
              async server => {
                const response = await fetch(server.url.origin);
                // connection terminated
                expect(await response.text()).toBe("");
                expect(response.status).toBe(options.status ?? 200);
                expect(pass).toBe(true);
              },
            );
          }

          it("with headers", async () => {
            await execute({
              headers: {
                "X-A": "123",
              },
            });
          });

          it("with headers and status", async () => {
            await execute({
              status: 204,
              headers: {
                "X-A": "123",
              },
            });
          });

          it("with status", async () => {
            await execute({
              status: 204,
            });
          });

          it("with empty object", async () => {
            await execute({});
          });
        });
      });

      it("text from JS, one chunk", async () => {
        const relative = new URL("./fetch.js.txt", import.meta.url);
        const textToExpect = readFileSync(relative, "utf-8");
        await runTest(
          {
            fetch(req) {
              return new Response(
                new ReadableStream({
                  start(controller) {
                    controller.enqueue(textToExpect);
                    controller.close();
                  },
                }),
              );
            },
          },
          async server => {
            const response = await fetch(server.url.origin);
            const text = await response.text();
            expect(text.length).toBe(textToExpect.length);
            expect(text).toBe(textToExpect);
          },
        );
      });
      it("text from JS, two chunks", async () => {
        const fixture = resolve(import.meta.dir, "./fetch.js.txt");
        const textToExpect = readFileSync(fixture, "utf-8");
        await runTest(
          {
            fetch(req) {
              return new Response(
                new ReadableStream({
                  start(controller) {
                    controller.enqueue(textToExpect.substring(0, 100));
                    controller.enqueue(textToExpect.substring(100));
                    controller.close();
                  },
                }),
              );
            },
          },
          async server => {
            const response = await fetch(server.url.origin);
            expect(await response.text()).toBe(textToExpect);
          },
        );
      });

      it("Error handler is called when a throwing stream hasn't written anything", async () => {
        await runTest(
          {
            error(e) {
              return new Response("Test Passed", { status: 200 });
            },

            fetch(req) {
              return new Response(
                new ReadableStream({
                  start(controller) {
                    throw new Error("Test Passed");
                  },
                }),
                {
                  status: 404,
                },
              );
            },
          },
          async server => {
            const response = await fetch(server.url.origin);
            expect(response.status).toBe(200);
            expect(await response.text()).toBe("Test Passed");
          },
        );
      });

      // Also verifies error handler reset in `.reload()` due to test above
      // TODO: rewrite test so uncaught error does not create an annotation in CI
      it.skip("text from JS throws on start with no error handler", async () => {
        await runTest(
          {
            error: undefined,

            fetch(req) {
              return new Response(
                new ReadableStream({
                  start(controller) {
                    throw new Error("Test Passed");
                  },
                }),
                {
                  status: 420,
                  headers: {
                    "x-what": "123",
                  },
                },
              );
            },
          },
          async server => {
            const response = await fetch(server.url.origin);
            expect(response.status).toBe(500);
          },
        );
      });

      it("text from JS throws on start has error handler", async () => {
        var pass = false;
        var err: Error;
        await runTest(
          {
            error(e) {
              pass = true;
              err = e;
              return new Response("Fail", { status: 500 });
            },
            fetch(req) {
              return new Response(
                new ReadableStream({
                  start(controller) {
                    throw new TypeError("error");
                  },
                }),
              );
            },
          },
          async server => {
            const response = await fetch(server.url.origin);
            expect(response.status).toBe(500);
            expect(await response.text()).toBe("Fail");
            expect(pass).toBe(true);
            expect(err?.name).toBe("TypeError");
            expect(err?.message).toBe("error");
          },
        );
      });

      it("text from JS, 2 chunks, with delay", async () => {
        const fixture = resolve(import.meta.dir, "./fetch.js.txt");
        const textToExpect = readFileSync(fixture, "utf-8");
        await runTest(
          {
            async fetch(req) {
              return new Response(
                new ReadableStream({
                  async start(controller) {
                    controller.enqueue(textToExpect.substring(0, 100));
                    await Bun.sleep(0);
                    queueMicrotask(() => {
                      controller.enqueue(textToExpect.substring(100));
                      controller.close();
                    });
                  },
                }),
              );
            },
          },
          async server => {
            const response = await fetch(server.url.origin);
            expect(await response.text()).toBe(textToExpect);
          },
        );
      });

      it("text from JS, 1 chunk via pull()", async () => {
        const fixture = resolve(import.meta.dir, "./fetch.js.txt");
        const textToExpect = readFileSync(fixture, "utf-8");
        await runTest(
          {
            fetch(req) {
              return new Response(
                new ReadableStream({
                  pull(controller) {
                    controller.enqueue(textToExpect);
                    controller.close();
                  },
                }),
              );
            },
          },
          async server => {
            const response = await fetch(server.url.origin);
            const text = await response.text();
            expect(text).toBe(textToExpect);
          },
        );
      });

      it("text from JS, 2 chunks, with delay in pull", async () => {
        const fixture = resolve(import.meta.dir, "./fetch.js.txt");
        const textToExpect = readFileSync(fixture, "utf-8");
        await runTest(
          {
            fetch(req) {
              return new Response(
                new ReadableStream({
                  async pull(controller) {
                    controller.enqueue(textToExpect.substring(0, 100));
                    await Bun.sleep(0);
                    queueMicrotask(() => {
                      controller.enqueue(textToExpect.substring(100));
                      controller.close();
                    });
                  },
                }),
              );
            },
          },
          async server => {
            const response = await fetch(server.url.origin);
            expect(await response.text()).toBe(textToExpect);
          },
        );
      });

      it("text from JS, 3 chunks, 1 empty, with delay in pull", async () => {
        const textToExpect = "hello world";
        const groups = [
          ["hello", "", " world"],
          ["", "hello ", "world"],
          ["hello ", "world", ""],
          ["hello world", "", ""],
          ["", "", "hello world"],
        ];
        var count = 0;

        for (const chunks of groups) {
          await runTest(
            {
              fetch(req) {
                return new Response(
                  new ReadableStream({
                    async pull(controller) {
                      for (let chunk of chunks) {
                        controller.enqueue(Buffer.from(chunk));
                        await Bun.sleep(0);
                      }
                      await Bun.sleep(0);
                      controller.close();
                    },
                  }),
                );
              },
            },
            async server => {
              const response = await fetch(server.url.origin);
              expect(await response.text()).toBe(textToExpect);
              count++;
            },
          );
        }
        expect(count).toBe(groups.length);
      });

      it("text from JS, 2 chunks, with async pull", async () => {
        const fixture = resolve(import.meta.dir, "./fetch.js.txt");
        const textToExpect = readFileSync(fixture, "utf-8");
        await runTest(
          {
            fetch(req) {
              return new Response(
                new ReadableStream({
                  async pull(controller) {
                    controller.enqueue(textToExpect.substring(0, 100));
                    await Bun.sleep(0);
                    controller.enqueue(textToExpect.substring(100));
                    await Bun.sleep(0);
                    controller.close();
                  },
                }),
              );
            },
          },
          async server => {
            const response = await fetch(server.url.origin);
            expect(await response.text()).toBe(textToExpect);
          },
        );
      });

      it("text from JS, 10 chunks, with async pull", async () => {
        const fixture = resolve(import.meta.dir, "./fetch.js.txt");
        const textToExpect = readFileSync(fixture, "utf-8");
        await runTest(
          {
            fetch(req) {
              return new Response(
                new ReadableStream({
                  async pull(controller) {
                    var remain = textToExpect;
                    for (let i = 0; i < 10 && remain.length > 0; i++) {
                      controller.enqueue(remain.substring(0, 100));
                      remain = remain.substring(100);
                      await Bun.sleep(0);
                    }

                    controller.enqueue(remain);
                    controller.close();
                  },
                }),
              );
            },
          },
          async server => {
            const response = await fetch(server.url.origin);
            expect(await response.text()).toBe(textToExpect);
          },
        );
      });
    });

    it("should work for a hello world", async () => {
      await runTest(
        {
          fetch(req) {
            return new Response(`Hello, world!`);
          },
        },
        async server => {
          const response = await fetch(server.url.origin);
          expect(await response.text()).toBe("Hello, world!");
        },
      );
    });

    it("should work for a blob", async () => {
      const fixture = resolve(import.meta.dir, "./fetch.js.txt");
      const textToExpect = readFileSync(fixture, "utf-8");
      await runTest(
        {
          fetch(req) {
            return new Response(new Blob([textToExpect]));
          },
        },
        async server => {
          const response = await fetch(server.url.origin);
          expect(await response.text()).toBe(textToExpect);
        },
      );
    });

    it("should work for a blob stream", async () => {
      const fixture = resolve(import.meta.dir, "./fetch.js.txt");
      const textToExpect = readFileSync(fixture, "utf-8");
      await runTest(
        {
          fetch(req) {
            return new Response(new Blob([textToExpect]).stream());
          },
        },
        async server => {
          const response = await fetch(server.url.origin);
          expect(await response.text()).toBe(textToExpect);
        },
      );
    });

    it("should work for a file stream", async () => {
      const fixture = resolve(import.meta.dir, "./fetch.js.txt");
      const textToExpect = readFileSync(fixture, "utf-8");
      await runTest(
        {
          fetch(req) {
            return new Response(file(fixture).stream());
          },
        },
        async server => {
          const response = await fetch(server.url.origin);
          expect(await response.text()).toBe(textToExpect);
        },
      );
    });

    it("fetch should work with headers", async () => {
      const fixture = resolve(import.meta.dir, "./fetch.js.txt");
      await runTest(
        {
          fetch(req) {
            if (req.headers.get("X-Foo") !== "bar") {
              return new Response("X-Foo header not set", { status: 500 });
            }
            return new Response(file(fixture), {
              headers: { "X-Both-Ways": "1" },
            });
          },
        },
        async server => {
          const response = await fetch(server.url.origin, {
            headers: {
              "X-Foo": "bar",
            },
          });
          expect(response.status).toBe(200);
          expect(response.headers.get("X-Both-Ways")).toBe("1");
        },
      );
    });

    it(`should work for a file ${count} times serial`, async () => {
      const fixture = resolve(import.meta.dir, "./fetch.js.txt");
      const textToExpect = readFileSync(fixture, "utf-8");
      await runTest(
        {
          async fetch(req) {
            return new Response(file(fixture));
          },
        },
        async server => {
          for (let i = 0; i < count; i++) {
            const response = await fetch(server.url.origin);
            expect(await response.text()).toBe(textToExpect);
          }
        },
      );
    });

    it(`should work for ArrayBuffer ${count} times serial`, async () => {
      const textToExpect = "hello";
      await runTest(
        {
          fetch(req) {
            return new Response(new TextEncoder().encode(textToExpect));
          },
        },
        async server => {
          for (let i = 0; i < count; i++) {
            const response = await fetch(server.url.origin);
            expect(await response.text()).toBe(textToExpect);
          }
        },
      );
    });

    describe("parallel", () => {
      it(`should work for text ${count} times in batches of 5`, async () => {
        const textToExpect = "hello";
        await runTest(
          {
            fetch(req) {
              return new Response(textToExpect);
            },
          },
          async server => {
            for (let i = 0; i < count; ) {
              let responses = await Promise.all([
                fetch(server.url.origin),
                fetch(server.url.origin),
                fetch(server.url.origin),
                fetch(server.url.origin),
                fetch(server.url.origin),
              ]);

              for (let response of responses) {
                expect(await response.text()).toBe(textToExpect);
              }
              i += responses.length;
            }
          },
        );
      });
      it(`should work for Uint8Array ${count} times in batches of 5`, async () => {
        const textToExpect = "hello";
        await runTest(
          {
            fetch(req) {
              return new Response(new TextEncoder().encode(textToExpect));
            },
          },
          async server => {
            for (let i = 0; i < count; ) {
              let responses = await Promise.all([
                fetch(server.url.origin),
                fetch(server.url.origin),
                fetch(server.url.origin),
                fetch(server.url.origin),
                fetch(server.url.origin),
              ]);

              for (let response of responses) {
                expect(await response.text()).toBe(textToExpect);
              }
              i += responses.length;
            }
          },
        );
      });
    });

    it("should support reloading", async () => {
      const first: Handler = req => new Response("first");
      const second: Handler = req => new Response("second");
      await runTest(
        {
          fetch: first,
        },
        async server => {
          const response = await fetch(server.url.origin);
          expect(await response.text()).toBe("first");
          server.reload({ fetch: second });
          const response2 = await fetch(server.url.origin);
          expect(await response2.text()).toBe("second");
        },
      );
    });

    describe("status code text", () => {
      const fixture = {
        200: "OK",
        201: "Created",
        202: "Accepted",
        203: "Non-Authoritative Information",
        204: "No Content",
        205: "Reset Content",
        206: "Partial Content",
        207: "Multi-Status",
        208: "Already Reported",
        226: "IM Used",
        300: "Multiple Choices",
        301: "Moved Permanently",
        302: "Found",
        303: "See Other",
        304: "Not Modified",
        305: "Use Proxy",
        306: "Switch Proxy",
        307: "Temporary Redirect",
        308: "Permanent Redirect",
        400: "Bad Request",
        401: "Unauthorized",
        402: "Payment Required",
        403: "Forbidden",
        404: "Not Found",
        405: "Method Not Allowed",
        406: "Not Acceptable",
        407: "Proxy Authentication Required",
        408: "Request Timeout",
        409: "Conflict",
        410: "Gone",
        411: "Length Required",
        412: "Precondition Failed",
        413: "Payload Too Large",
        414: "URI Too Long",
        415: "Unsupported Media Type",
        416: "Range Not Satisfiable",
        417: "Expectation Failed",
        418: "I'm a Teapot",
        421: "Misdirected Request",
        422: "Unprocessable Entity",
        423: "Locked",
        424: "Failed Dependency",
        425: "Too Early",
        426: "Upgrade Required",
        428: "Precondition Required",
        429: "Too Many Requests",
        431: "Request Header Fields Too Large",
        451: "Unavailable For Legal Reasons",
        500: "Internal Server Error",
        501: "Not Implemented",
        502: "Bad Gateway",
        503: "Service Unavailable",
        504: "Gateway Timeout",
        505: "HTTP Version Not Supported",
        506: "Variant Also Negotiates",
        507: "Insufficient Storage",
        508: "Loop Detected",
        510: "Not Extended",
        511: "Network Authentication Required",
      } as Record<string, string>;

      for (let code in fixture) {
        it(`should return ${code} ${fixture[code]}`, async () => {
          await runTest(
            {
              fetch(req) {
                return new Response("hey", { status: +code });
              },
            },
            async server => {
              const response = await fetch(server.url.origin);
              expect(response.status).toBe(parseInt(code));
              expect(response.statusText).toBe(fixture[code]);
            },
          );
        });
      }
    });

    it("should support multiple Set-Cookie headers", async () => {
      await runTest(
        {
          fetch(req) {
            return new Response("hello", {
              headers: [
                ["Another-Header", "1"],
                ["Set-Cookie", "foo=bar"],
                ["Set-Cookie", "baz=qux"],
              ],
            });
          },
        },
        async server => {
          const response = await fetch(server.url.origin);
          expect(response.headers.getAll("Set-Cookie")).toEqual(["foo=bar", "baz=qux"]);
          expect(response.headers.get("Set-Cookie")).toEqual("foo=bar, baz=qux");

          const cloned = response.clone().headers;
          expect(response.headers.getAll("Set-Cookie")).toEqual(["foo=bar", "baz=qux"]);

          response.headers.delete("Set-Cookie");
          expect(response.headers.getAll("Set-Cookie")).toEqual([]);
          response.headers.delete("Set-Cookie");
          expect(cloned.getAll("Set-Cookie")).toEqual(["foo=bar", "baz=qux"]);
          expect(new Headers(cloned).getAll("Set-Cookie")).toEqual(["foo=bar", "baz=qux"]);
        },
      );
    });

    describe("should support Content-Range with Bun.file()", () => {
      // this must be a big file so we can test potentially multiple chunks
      // more than 65 KB
      const full = (function () {
        const fixture = resolve(import.meta.dir + "/fetch.js.txt");
        const chunk = readFileSync(fixture);
        var whole = new Uint8Array(chunk.byteLength * 128);
        for (var i = 0; i < 128; i++) {
          whole.set(chunk, i * chunk.byteLength);
        }
        writeFileSync(fixture + ".big", whole);
        return whole;
      })();
      const fixture = resolve(import.meta.dir + "/fetch.js.txt") + ".big";
      const getServer = runTest.bind(null, {
        fetch(req) {
          const { searchParams } = new URL(req.url);
          const start = Number(searchParams.get("start"));
          const end = Number(searchParams.get("end"));
          return new Response(Bun.file(fixture).slice(start, end));
        },
      });

      const getServerWithSize = runTest.bind(null, {
        fetch(req) {
          const { searchParams } = new URL(req.url);
          const start = Number(searchParams.get("start"));
          const end = Number(searchParams.get("end"));
          const file = Bun.file(fixture);
          return new Response(file.slice(start, end), {
            headers: { "Content-Range": "bytes " + start + "-" + end + "/" + file.size },
          });
        },
      });

      const good = [
        [0, 1],
        [1, 2],
        [0, 10],
        [10, 20],
        [0, Infinity],
        [10, Infinity],
        [NaN, Infinity],
        [full.byteLength - 10, full.byteLength],
        [full.byteLength - 10, full.byteLength - 1],
        [full.byteLength - 1, full.byteLength],
        [0, full.byteLength],
      ] as const;

      for (const [start, end] of good) {
        it(`good range: ${start} - ${end}`, async () => {
          await getServer(async server => {
            const response = await fetch(`${server.url.origin}/?start=${start}&end=${end}`, {
              verbose: true,
            });
            expect(await response.arrayBuffer()).toEqual(full.buffer.slice(start, end));
            expect(response.status).toBe(start > 0 || end < full.byteLength ? 206 : 200);
          });
        });
      }

      for (const [start, end] of good) {
        it(`good range with size: ${start} - ${end}`, async () => {
          await getServerWithSize(async server => {
            const response = await fetch(`${server.url.origin}/?start=${start}&end=${end}`, {
              verbose: true,
            });
            expect(parseInt(response.headers.get("Content-Range")?.split("/")[1])).toEqual(full.byteLength);
            expect(await response.arrayBuffer()).toEqual(full.buffer.slice(start, end));
            expect(response.status).toBe(start > 0 || end < full.byteLength ? 206 : 200);
          });
        });
      }

      const emptyRanges = [
        [0, 0],
        [1, 1],
        [10, 10],
        [-Infinity, -Infinity],
        [Infinity, Infinity],
        [NaN, NaN],
        [(full.byteLength / 2) | 0, (full.byteLength / 2) | 0],
        [full.byteLength, full.byteLength],
        [full.byteLength - 1, full.byteLength - 1],
      ];

      for (const [start, end] of emptyRanges) {
        it(`empty range: ${start} - ${end}`, async () => {
          await getServer(async server => {
            const response = await fetch(`${server.url.origin}/?start=${start}&end=${end}`);
            const out = await response.arrayBuffer();
            expect(out).toEqual(new ArrayBuffer(0));
            expect(response.status).toBe(206);
          });
        });
      }

      const badRanges = [
        [10, NaN],
        [10, -Infinity],
        [-(full.byteLength / 2) | 0, Infinity],
        [-(full.byteLength / 2) | 0, -Infinity],
        [full.byteLength + 100, full.byteLength],
        [full.byteLength + 100, full.byteLength + 100],
        [full.byteLength + 100, full.byteLength + 1],
        [full.byteLength + 100, -full.byteLength],
      ];

      for (const [start, end] of badRanges) {
        it(`bad range: ${start} - ${end}`, async () => {
          await getServer(async server => {
            const response = await fetch(`${server.url.origin}/?start=${start}&end=${end}`);
            const out = await response.arrayBuffer();
            expect(out).toEqual(new ArrayBuffer(0));
            expect(response.status).toBe(206);
          });
        });
      }
    });

    it("formats error responses correctly", async () => {
      const c = spawn(bunExe(), ["./error-response.js"], { cwd: import.meta.dir, env: bunEnv });

      var output = "";
      c.stderr.on("data", chunk => {
        output += chunk.toString();
      });
      c.stderr.on("end", () => {
        expect(output).toContain('throw new Error("1");');
        c.kill();
      });
    });

    it("request body and signal life cycle", async () => {
      renderToReadableStream = (await import("react-dom/server")).renderToReadableStream;
      app_jsx = (await import("./app")).default;
      {
        const headers = {
          headers: {
            "Content-Type": "text/html",
          },
        };

        const server = Bun.serve({
          port: 0,
          async fetch(req) {
            return new Response(await renderToReadableStream(app_jsx), headers);
          },
        });

        try {
          const requests = [];
          for (let j = 0; j < 10; j++) {
            for (let i = 0; i < 250; i++) {
              requests.push(fetch(server.url.origin));
            }

            await Promise.all(requests);
            requests.length = 0;
            Bun.gc(true);
          }
        } catch (e) {
          console.error(e);
        }
        await Bun.sleep(10);
        expect(true).toBe(true);
        server.stop(true);
      }
    }, 30_000);

    it("propagates content-type from a Bun.file()'s file path in fetch()", async () => {
      const body = Bun.file(import.meta.dir + "/fetch.js.txt");
      const bodyText = await body.text();

      const server = Bun.serve({
        port: 0,
        development: false,
        async fetch(req) {
          expect(req.headers.get("Content-Type")).toBe("text/plain;charset=utf-8");
          const text = await req.text();
          expect(text).toBe(bodyText);

          return new Response(Bun.file(import.meta.dir + "/fetch.js.txt"));
        },
      });

      // @ts-ignore
      const reqBody = new Request(server.url.origin, {
        body,
        method: "POST",
      });
      const res = await fetch(reqBody);
      expect(res.status).toBe(200);

      // but it does for Response
      expect(res.headers.get("Content-Type")).toBe("text/plain;charset=utf-8");

      server.stop(true);
    });

    it("does propagate type for Blob", async () => {
      const server = Bun.serve({
        port: 0,
        development: false,
        async fetch(req) {
          expect(req.headers.get("Content-Type")).toBeNull();
          return new Response(new Blob(["hey"], { type: "text/plain;charset=utf-8" }));
        },
      });

      const body = new Blob(["hey"], { type: "text/plain;charset=utf-8" });
      // @ts-ignore
      const res = await fetch(server.url.origin, {
        body,
        method: "POST",
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/plain;charset=utf-8");

      server.stop(true);
    });

    it("unix socket connection in Bun.serve", async () => {
      const unix = join(tmpdir(), "bun." + Date.now() + ((Math.random() * 32) | 0).toString(16) + ".sock");
      const server = Bun.serve({
        port: 0,
        unix,

        async fetch(req) {
          expect(req.headers.get("Content-Type")).toBeNull();
          return new Response(new Blob(["hey"], { type: "text/plain;charset=utf-8" }));
        },
      });

      const requestText = `GET / HTTP/1.1\r\nHost: localhost\r\n\r\n`;
      const received: Buffer[] = [];
      const { resolve, promise } = Promise.withResolvers();
      const connection = await Bun.connect({
        unix,
        socket: {
          data(socket, data) {
            received.push(data);
            resolve();
          },
        },
      });
      connection.write(requestText);
      connection.flush();
      await promise;
      expect(Buffer.concat(received).toString()).toEndWith("\r\n\r\nhey");
      connection.end();
      server.stop(true);
    });

    it("unix socket connection throws an error on a bad domain without crashing", async () => {
      const unix = "/i/don/tevent/exist/because/the/directory/is/invalid/yes.sock";
      expect(() => {
        const server = Bun.serve({
          port: 0,
          unix,

          async fetch(req) {
            expect(req.headers.get("Content-Type")).toBeNull();
            return new Response(new Blob(["hey"], { type: "text/plain;charset=utf-8" }));
          },
        });
      }).toThrow();
    });

    it("#5859 text", async () => {
      const server = Bun.serve({
        port: 0,
        development: false,
        async fetch(req) {
          return new Response(await req.text(), {});
        },
      });

      const response = await fetch(server.url.origin, {
        method: "POST",
        body: new Uint8Array([0xfd]),
      });

      expect(await response.text()).toBe("�");
      await server.stop(true);
    });

    it("#5859 json", async () => {
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          try {
            await req.json();
          } catch (e) {
            return new Response("FAIL", { status: 500 });
          }

          return new Response("SHOULD'VE FAILED", {});
        },
      });

      const response = await fetch(server.url.origin, {
        method: "POST",
        body: new Uint8Array([0xfd]),
      });

      expect(response.ok).toBeFalse();
      expect(await response.text()).toBe("FAIL");
      await server.stop(true);
    });

    it("#5859 arrayBuffer", async () => {
      await Bun.write("/tmp/bad", new Uint8Array([0xfd]));
      expect(async () => await Bun.file("/tmp/bad").json()).toThrow();
    });

    it("server.requestIP (v4)", async () => {
      const server = Bun.serve({
        port: 0,
        fetch(req, server) {
          return Response.json(server.requestIP(req));
        },
        hostname: "127.0.0.1",
      });

      const response = await fetch(server.url.origin).then(x => x.json());
      expect(response).toEqual({
        address: "127.0.0.1",
        family: "IPv4",
        port: expect.any(Number),
      });
      server.stop(true);
    });

    it("server.requestIP (v6)", async () => {
      const server = Bun.serve({
        port: 0,
        fetch(req, server) {
          return Response.json(server.requestIP(req));
        },
        hostname: "::1",
      });

      const response = await fetch(`http://localhost:${server.port}`).then(x => x.json());
      expect(response).toEqual({
        address: "::1",
        family: "IPv6",
        port: expect.any(Number),
      });
      server.stop(true);
    });

    it("server.requestIP (unix)", async () => {
      const unix = "/tmp/bun-serve.sock";
      const server = Bun.serve({
        unix,
        fetch(req, server) {
          return Response.json(server.requestIP(req));
        },
      });
      const requestText = `GET / HTTP/1.1\r\nHost: localhost\r\n\r\n`;
      const received: Buffer[] = [];
      const { resolve, promise } = Promise.withResolvers<void>();
      const connection = await Bun.connect({
        unix,
        socket: {
          data(socket, data) {
            received.push(data);
            resolve();
          },
        },
      });
      connection.write(requestText);
      connection.flush();
      await promise;
      expect(Buffer.concat(received).toString()).toEndWith("\r\n\r\nnull");
      connection.end();
      server.stop(true);
    });

    it("should response with HTTP 413 when request body is larger than maxRequestBodySize, issue#6031", async () => {
      const server = Bun.serve({
        port: 0,
        maxRequestBodySize: 10,
        fetch(req, server) {
          return new Response("OK");
        },
      });

      {
        const resp = await fetch(server.url.origin, {
          method: "POST",
          body: "A".repeat(10),
        });
        expect(resp.status).toBe(200);
        expect(await resp.text()).toBe("OK");
      }
      {
        const resp = await fetch(server.url.origin, {
          method: "POST",
          body: "A".repeat(11),
        });
        expect(resp.status).toBe(413);
      }

      server.stop(true);
    });

    it("should support promise returned from error", async () => {
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          throw new Error(req.url);
        },
        async error(e) {
          if (e.message.endsWith("/async-fulfilled")) {
            return new Response("OK");
          }

          if (e.message.endsWith("/async-rejected")) {
            throw new Error("");
          }

          if (e.message.endsWith("/async-rejected-pending")) {
            await Bun.sleep(100);
            throw new Error("");
          }

          if (e.message.endsWith("/async-pending")) {
            await Bun.sleep(100);
            return new Response("OK");
          }
        },
      });

      {
        const resp = await fetch(`${server.url.origin}/async-fulfilled`);
        expect(resp.status).toBe(200);
        expect(await resp.text()).toBe("OK");
      }

      {
        const resp = await fetch(`${server.url.origin}/async-pending`);
        expect(resp.status).toBe(200);
        expect(await resp.text()).toBe("OK");
      }

      {
        const resp = await fetch(`${server.url.origin}/async-rejected`);
        expect(resp.status).toBe(500);
      }

      {
        const resp = await fetch(`${server.url.origin}/async-rejected-pending`);
        expect(resp.status).toBe(500);
      }

      server.stop(true);
    });
  });
}

if (process.platform === "linux")
  it("should use correct error when using a root range port(#7187)", () => {
    expect(() => {
      const server = Bun.serve({
        port: 1003,
        fetch(req) {
          return new Response("request answered");
        },
      });
    }).toThrow("permission denied 0.0.0.0:1003");
  });

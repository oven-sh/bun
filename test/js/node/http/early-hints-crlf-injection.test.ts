import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { once } from "node:events";
import { createServer, get, type IncomingMessage, type InformationEvent, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { text } from "node:stream/consumers";

describe("writeEarlyHints", () => {
  // All scenarios share one server. The request path selects the hints the
  // handler passes to res.writeEarlyHints(), and the handler records what the
  // call threw instead of asserting in place, so a mismatch shows up as a
  // failed expect() in the test rather than as a response that never arrives.
  type Scenario = { hints: Record<string, string>; thrown: unknown; cpuMs: number };
  const scenarios = new Map<string, Scenario>();
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const scenario = scenarios.get(req.url!)!;
      const cpuBefore = process.cpuUsage();
      try {
        res.writeEarlyHints(scenario.hints);
      } catch (error) {
        scenario.thrown = error;
      }
      const { user, system } = process.cpuUsage(cpuBefore);
      scenario.cpuMs = (user + system) / 1000;
      res.end("ok");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    const closed = once(server, "close");
    server.close();
    await closed;
  });

  async function writeEarlyHintsFor(hints: Record<string, string>) {
    const path = `/${scenarios.size}`;
    const scenario: Scenario = { hints, thrown: undefined, cpuMs: NaN };
    scenarios.set(path, scenario);

    const earlyHints: InformationEvent[] = [];
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      get({ host: "127.0.0.1", port, path, agent: false }, resolve)
        .on("information", info => earlyHints.push(info))
        .on("error", reject);
    });

    return {
      outcome: {
        thrown: scenario.thrown,
        earlyHints,
        response: { statusCode: response.statusCode, body: await text(response) },
      },
      /** CPU time the res.writeEarlyHints() call itself took, in milliseconds. */
      cpuMs: scenario.cpuMs,
    };
  }

  const okResponse = { statusCode: 200, body: "ok" };

  test("rejects CRLF injection in header name", async () => {
    const name = "x-custom\r\nSet-Cookie: session=evil\r\nX-Injected";
    const { outcome } = await writeEarlyHintsFor({ link: "</style.css>; rel=preload", [name]: "val" });

    expect(outcome.thrown).toBeInstanceOf(TypeError);
    expect(outcome).toEqual({
      thrown: expect.objectContaining({
        code: "ERR_INVALID_HTTP_TOKEN",
        message: `Header name must be a valid HTTP token ["${name}"]`,
      }),
      earlyHints: [],
      response: okResponse,
    });
  });

  test("rejects CRLF injection in header value", async () => {
    const { outcome } = await writeEarlyHintsFor({
      link: "</style.css>; rel=preload",
      "x-custom": "legitimate\r\nSet-Cookie: session=evil",
    });

    expect(outcome.thrown).toBeInstanceOf(TypeError);
    expect(outcome).toEqual({
      thrown: expect.objectContaining({
        code: "ERR_INVALID_CHAR",
        message: 'Invalid character in header content ["x-custom"]',
      }),
      earlyHints: [],
      response: okResponse,
    });
  });

  test("rejects CRLF injection in the link value", async () => {
    // The Link format check accepts anything between "<" and ">", so this one
    // is caught by the separate CR/LF check on the link value.
    const { outcome } = await writeEarlyHintsFor({ link: "</style.css\r\nSet-Cookie: session=evil>; rel=preload" });

    expect(outcome.thrown).toBeInstanceOf(TypeError);
    expect(outcome).toEqual({
      thrown: expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
        message:
          `The argument 'hints' must be an array or string of format "</styles.css>; rel=preload; as=style". ` +
          `Received '</style.css\\r\\nSet-Cookie: session=evil>; rel=preload'`,
      }),
      earlyHints: [],
      response: okResponse,
    });
  });

  test("allows valid non-link headers in early hints", async () => {
    const { outcome } = await writeEarlyHintsFor({
      link: "</style.css>; rel=preload",
      "x-custom": "valid-value",
      "x-another": "also-valid",
    });

    expect(outcome).toEqual({
      thrown: undefined,
      earlyHints: [
        {
          httpVersion: "1.1",
          httpVersionMajor: 1,
          httpVersionMinor: 1,
          statusCode: 103,
          statusMessage: "Early Hints",
          headers: { "link": "</style.css>; rel=preload", "x-custom": "valid-value", "x-another": "also-valid" },
          rawHeaders: ["Link", "</style.css>; rel=preload", "x-custom", "valid-value", "x-another", "also-valid"],
        },
      ],
      response: okResponse,
    });
  });

  test("rejects pathological link value without catastrophic backtracking", async () => {
    // If the link-param name class admits "=", every ";a=b" matches two ways
    // and the trailing space makes the regex backtrack through all 2^32
    // combinations. JSC stops such a match at Yarr::matchLimit (~2s of CPU) and
    // reports no match, so a regressed regex still throws the error asserted
    // below; only the CPU time of the call tells it apart from the ~1ms a
    // linear check takes. CPU time rather than wall-clock so a preempted CI
    // machine cannot fail this.
    const link = "</x>" + ";a=b".repeat(32) + " ";
    const { outcome, cpuMs } = await writeEarlyHintsFor({ link });

    expect(cpuMs).toBeLessThan(250);
    expect(outcome.thrown).toBeInstanceOf(TypeError);
    expect(outcome).toEqual({
      thrown: expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
        message:
          `The argument 'hints' must be an array or string of format "</styles.css>; rel=preload; as=style". ` +
          `Received '${link}'`,
      }),
      earlyHints: [],
      response: okResponse,
    });
  });
});

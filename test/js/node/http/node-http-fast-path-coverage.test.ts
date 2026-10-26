import { describe, expect, test } from "bun:test";
import { bunExe, isASAN, isCI, isDebug } from "harness";
import { type Coverage, fixture, measure, stacks } from "./node-http-fast-path-coverage";

// The node:http server has a fast path for dispatching a request, a compact form for response headers and a finish that
// takes a single process.nextTick(). This pins how many requests of ordinary applications take each of them, so that a
// change which quietly pushes a framework onto the slow path fails here. The functions of the fast path have the names
// of those they stand in for, so the fixture tells them apart by the place of the onNodeHTTPRequest frame, the kOutHeaders
// symbol and the number of arguments of the emitResponseFinished tick: changing one means updating it.
//
// The compact form is for an executable built with --aot, which
// test/aot/node-http-requests-on-a-keep-alive-connection-take-the-fast-path.test.ts measures with the same fixture.
// Under `bun run` a response has its headers in the map under kOutHeaders from the first one that is stored.

const timeout = (isASAN || isDebug) && !isCI ? 90_000 : undefined;

const routesThatStoreNoHeader: Record<string, string[]> = { "node:http": ["GET /text", "GET /missing"] };

function withHeadersInTheMap(stack: string, expected: Coverage): Coverage {
  const result: Coverage = {};
  for (const route in expected) {
    result[route] = { ...expected[route], compactHeaders: routesThatStoreNoHeader[stack]?.includes(route) ? 10 : 0 };
  }
  return result;
}

describe.concurrent("requests on a keep-alive connection take the fast path", () => {
  test.each(stacks)(
    "%s",
    async (stack, expected) => {
      expect(await measure([bunExe(), fixture, stack])).toEqual(withHeadersInTheMap(stack, expected));
    },
    timeout,
  );
});

import { expect, test } from "bun:test";
import { ServerResponse } from "node:http";
import { inspect } from "node:util";

test("four methods of ServerResponse.prototype print without a name", () => {
  for (const key of ["detachSocket", "_implicitHeader", "writeHead", "emit"] as const) {
    const method = ServerResponse.prototype[key] as Function;
    expect([key, method.name, Bun.inspect(method), inspect(method)]).toEqual([
      key,
      "",
      "[Function]",
      "[Function (anonymous)]",
    ]);
  }
});

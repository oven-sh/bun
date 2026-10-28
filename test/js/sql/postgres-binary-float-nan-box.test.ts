// A malicious or compromised server controls the raw 8 bytes of a binary
// float8 column. SQLClient.cpp boxes that double into a JSValue; without
// purifyNaN() a non-canonical NaN bit pattern collides with JSC's JSVALUE64
// tag ranges, so the server can forge an arbitrary JSValue (boolean,
// undefined, a cell pointer) out of a column typed `double precision`.
// A numeric column must always come back as a number. See issue #33823.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

const FLOAT8_OID = 701;

// Each of these IEEE-754 bit patterns is a NaN whose payload, once jsNumber()
// adds DoubleEncodeOffset, used to decode as a forged immediate JSValue:
//   fffe000000000007 -> boolean true
//   fffe00000000000a -> undefined
//   fffc000012345678 -> int32 0x12345678
// After purifyNaN() every NaN collapses to the canonical NaN, so all three
// must come back as the number NaN.
const forgedNaNBits = ["fffe000000000007", "fffe00000000000a", "fffc000012345678"];

async function selectForgedFloat8(rawBitsHex: string): Promise<unknown> {
  const columnBytes = Buffer.from(rawBitsHex, "hex");
  const { port, server } = await listeningServer(socket => {
    let startup = true;
    socket.on("data", () => {
      if (startup) {
        startup = false;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        return;
      }
      socket.write(
        Buffer.concat([
          pgRowDescription([{ name: "n", typeOid: FLOAT8_OID, format: 1 }]),
          pgDataRow([columnBytes]),
          pgCommandComplete("SELECT 1"),
          pgReadyForQuery(),
        ]),
      );
    });
    socket.on("error", () => {});
  });

  try {
    await using sql = new SQL({
      url: `postgres://u@127.0.0.1:${port}/db`,
      max: 1,
      idleTimeout: 5,
      connectionTimeout: 5,
    });
    const [row]: any = await sql`select x`.simple();
    return row.n;
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
}

test.each(forgedNaNBits)("binary float8 NaN payload 0x%s comes back as number, not a forged JSValue", async bits => {
  const value = await selectForgedFloat8(bits);
  expect(typeof value).toBe("number");
  expect(Number.isNaN(value as number)).toBe(true);
});

test("binary float8 decodes an ordinary double", async () => {
  // 3.5 as big-endian IEEE-754 bits: not a NaN, must survive untouched.
  const bits = Buffer.alloc(8);
  bits.writeDoubleBE(3.5, 0);
  const value = await selectForgedFloat8(bits.toString("hex"));
  expect(value).toBe(3.5);
});

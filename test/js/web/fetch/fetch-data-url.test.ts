import { describe, expect, it, test } from "bun:test";

test("fetch(data:) rejects invalid data URLs with TypeError", async () => {
  for (const url of ["data:", "data:text/html", "data://test:test/,X"]) {
    try {
      await fetch(url);
      expect.unreachable(`${url} should reject`);
    } catch (e) {
      expect(e).toBeInstanceOf(TypeError);
    }
  }
});

test("fetch(data:) Content-Type survives body consumption", async () => {
  const res = await fetch("data:text/html,hi");
  await res.arrayBuffer();
  expect(res.headers.get("content-type")).toBe("text/html");
});

// https://fetch.spec.whatwg.org/#data-url-processor
// Cases from WPT fetch/data-urls/resources/data-urls.json.
describe.each([
  ["data://test/,X", "text/plain;charset=US-ASCII", [88]],
  ["data:,X", "text/plain;charset=US-ASCII", [88]],
  ["data:,", "text/plain;charset=US-ASCII", []],
  ["data:,X#X", "text/plain;charset=US-ASCII", [88]],
  ["data:,%FF", "text/plain;charset=US-ASCII", [255]],
  ["data:text/plain,X", "text/plain", [88]],
  ["data:text/plain ,X", "text/plain", [88]],
  ["data:text/plain%20,X", "text/plain%20", [88]],
  ["data:text/plain\f,X", "text/plain%0c", [88]],
  ["data:text/plain%0C,X", "text/plain%0c", [88]],
  ["data:text/plain;,X", "text/plain", [88]],
  ["data:;x=x;charset=x,X", "text/plain;x=x;charset=x", [88]],
  ["data:;x=x,X", "text/plain;x=x", [88]],
  ["data:text/plain;charset=windows-1252,%C2%B1", "text/plain;charset=windows-1252", [194, 177]],
  ["data:text/plain;Charset=UTF-8,%C2%B1", "text/plain;charset=UTF-8", [194, 177]],
  ["data:image/gif,%C2%B1", "image/gif", [194, 177]],
  ["data:IMAGE/gif,%C2%B1", "image/gif", [194, 177]],
  ["data:IMAGE/gif;hi=x,%C2%B1", "image/gif;hi=x", [194, 177]],
  ["data:IMAGE/gif;CHARSET=x,%C2%B1", "image/gif;charset=x", [194, 177]],
  ["data: ,%FF", "text/plain;charset=US-ASCII", [255]],
  ["data:%20,%FF", "text/plain;charset=US-ASCII", [255]],
  ["data:\f,%FF", "text/plain;charset=US-ASCII", [255]],
  ["data:%1F,%FF", "text/plain;charset=US-ASCII", [255]],
  ["data:%00,%FF", "text/plain;charset=US-ASCII", [255]],
  ["data:text/html  ,X", "text/html", [88]],
  ["data:text / html,X", "text/plain;charset=US-ASCII", [88]],
  ["data:†,X", "text/plain;charset=US-ASCII", [88]],
  ["data:†/†,X", "%e2%80%a0/%e2%80%a0", [88]],
  ["data:X,X", "text/plain;charset=US-ASCII", [88]],
  ["data:image/png,X X", "image/png", [88, 32, 88]],
  ["data:application/xml,X X", "application/xml", [88, 32, 88]],
  ["data:unknown/unknown,X X", "unknown/unknown", [88, 32, 88]],
  ['data:text/plain;a=",",X', 'text/plain;a=""', [34, 44, 88]],
  ["data:text/plain;a=%2C,X", "text/plain;a=%2C", [88]],
  ["data:;base64;base64,WA", "text/plain", [88]],
  ["data:x/x;base64;base64,WA", "x/x", [88]],
  ["data:x/x;base64;charset=x,WA", "x/x;charset=x", [87, 65]],
  ["data:x/x;base64;charset=x;base64,WA", "x/x;charset=x", [88]],
  ["data:x/x;base64;base64x,WA", "x/x", [87, 65]],
  ["data:;base64,W%20A", "text/plain;charset=US-ASCII", [88]],
  ["data:;base64,W%0CA", "text/plain;charset=US-ASCII", [88]],
  ["data:x;base64x,WA", "text/plain;charset=US-ASCII", [87, 65]],
  ["data:x;base64;x,WA", "text/plain;charset=US-ASCII", [87, 65]],
  ["data:x;base64=x,WA", "text/plain;charset=US-ASCII", [87, 65]],
  ["data:; base64,WA", "text/plain;charset=US-ASCII", [88]],
  ["data:;  base64,WA", "text/plain;charset=US-ASCII", [88]],
  ["data:  ;charset=x   ;  base64,WA", "text/plain;charset=x", [88]],
  ["data:;base64;,WA", "text/plain", [87, 65]],
  ["data:;base64 ,WA", "text/plain;charset=US-ASCII", [88]],
  ["data:;base64   ,WA", "text/plain;charset=US-ASCII", [88]],
  ["data:;base 64,WA", "text/plain", [87, 65]],
  ["data:;BASe64,WA", "text/plain;charset=US-ASCII", [88]],
  ["data:;%62ase64,WA", "text/plain", [87, 65]],
  ["data:%3Bbase64,WA", "text/plain;charset=US-ASCII", [87, 65]],
  ["data:;charset=x,X", "text/plain;charset=x", [88]],
  ["data:; charset=x,X", "text/plain;charset=x", [88]],
  ["data:;charset =x,X", "text/plain", [88]],
  ["data:;charset= x,X", 'text/plain;charset=" x"', [88]],
  ["data:;charset=,X", "text/plain", [88]],
  ["data:;charset,X", "text/plain", [88]],
  ['data:;charset="x",X', "text/plain;charset=x", [88]],
  ['data:;CHARSET="X",X', "text/plain;charset=X", [88]],
  ["data:text/plain;a=b;base64,WA", "text/plain;a=b", [88]],
  ["data:;base64,W A", "text/plain;charset=US-ASCII", [88]],
  ["data:;base64,WA", "text/plain;charset=US-ASCII", [88]],
] as const)("fetch(data:) processing %j", (url, expectedType, expectedBody) => {
  it(`-> ${JSON.stringify(expectedType)} ${JSON.stringify(expectedBody)}`, async () => {
    const res = await fetch(url);
    const body = [...new Uint8Array(await res.arrayBuffer())];
    expect({ type: res.headers.get("content-type"), body }).toEqual({
      type: expectedType,
      body: [...expectedBody],
    });
  });
});

// Bun 1.4.4 wrote the snapshots of this file, here and in __snapshots__/older-forms.fixture.js.snap.
// To add a case, run it under that version. Never update them with a later Bun.
import { expect, jest, test } from "bun:test";
import { Stats } from "node:fs";
import vm from "node:vm";

class Sub extends Response {}
const response = () => new Response("a", { status: 201 });
const context = sandbox => vm.runInContext("this", vm.createContext(sandbox));
const both = value => {
  expect(value()).toMatchSnapshot();
  return expect(value());
};

test("a Response", () => {
  both(response).toMatchInlineSnapshot(`Response (1 bytes) {
  ok: true,
  url: "",
  status: 201,
  statusText: "",
  headers: Headers {},
  redirected: false,
  bodyUsed: false,
  Blob (1 bytes)
}Response {}`);
});
test("a Response in an object, an array and a Map", () => {
  both(() => ({ id: 1, response: response(), list: [response()], map: new Map([["key", response()]]) })).toMatchInlineSnapshot(`
    {
      "id": 1,
      "list": [
        Response (1 bytes) {
          ok: true,
          url: "",
          status: 201,
          statusText: "",
          headers: Headers {},
          redirected: false,
          bodyUsed: false,
          Blob (1 bytes)
        }Response {},
      ],
      "map": 
    Map {
        "key" => Response (1 bytes) {
          ok: true,
          url: "",
          status: 201,
          statusText: "",
          headers: Headers {},
          redirected: false,
          bodyUsed: false,
          Blob (1 bytes)
        }Response {},
      }
    ,
      "response": Response (1 bytes) {
        ok: true,
        url: "",
        status: 201,
        statusText: "",
        headers: Headers {},
        redirected: false,
        bodyUsed: false,
        Blob (1 bytes)
      }Response {},
    }
  `);
});
test("an instance of a class that extends Response", () => {
  both(() => new Sub("a", { status: 201 })).toMatchInlineSnapshot(`Response (1 bytes) {
  ok: true,
  url: "",
  status: 201,
  statusText: "",
  headers: Headers {},
  redirected: false,
  bodyUsed: false,
  Blob (1 bytes)
}Sub {}`);
});
test("a Response with a property of its own", () => {
  both(() => Object.assign(response(), { extra: 1 })).toMatchInlineSnapshot(`Response (1 bytes) {
  ok: true,
  url: "",
  status: 201,
  statusText: "",
  headers: Headers {},
  redirected: false,
  bodyUsed: false,
  Blob (1 bytes)
}Response 
Response {
  "extra": 1,
}
`);
  both(() => [Object.assign(response(), { extra: 1 })]).toMatchInlineSnapshot(`
    [
      Response (1 bytes) {
        ok: true,
        url: "",
        status: 201,
        statusText: "",
        headers: Headers {},
        redirected: false,
        bodyUsed: false,
        Blob (1 bytes)
      }Response Response {
        "extra": 1,
      },
    ]
  `);
});
test("a Response next to an accessor", () => {
  both(() => ({ get accessor() { return 1; }, response: response() })).toMatchInlineSnapshot(`
    {
      "accessor": [native code],
      "response": Response (1 bytes) {
        ok: true,
        url: "",
        status: 201,
        statusText: "",
        headers: Headers {},
        redirected: false,
        bodyUsed: false,
        Blob (1 bytes)
      }Response {},
    }
  `);
});
test("a Response in an object that has property matchers", () => {
  expect({ id: 1, response: response() }).toMatchSnapshot({ id: expect.any(Number) });
  expect({ id: 1, response: response() }).toMatchInlineSnapshot({ id: expect.any(Number) }, `
    {
      "id": Any<Number>,
      "response": Response (1 bytes) {
        ok: true,
        url: "",
        status: 201,
        statusText: "",
        headers: Headers {},
        redirected: false,
        bodyUsed: false,
        Blob (1 bytes)
      }Response {},
    }
  `);
});
test("a Response that a promise resolves to", async () => {
  await expect(Promise.resolve(response())).resolves.toMatchSnapshot();
  await expect(Promise.resolve(response())).resolves.toMatchInlineSnapshot(`Response (1 bytes) {
  ok: true,
  url: "",
  status: 201,
  statusText: "",
  headers: Headers {},
  redirected: false,
  bodyUsed: false,
  Blob (1 bytes)
}Response {}`);
});
test("expect.any() of a class", () => {
  both(() => ({
    url: expect.any(URL),
    buffer: expect.not.any(Buffer),
    list: [expect.any(Headers), expect.any(Event)],
    cookie: expect.any(Bun.Cookie),
    stats: expect.any(Stats),
    mock: expect.any(jest.fn()),
    number: expect.any(Number),
    response: expect.any(Response),
    fn: expect.any(Function),
    inside: expect.objectContaining({ url: expect.any(URL) }),
  })).toMatchInlineSnapshot(`
    {
      "buffer": NotAny<Function>,
      "cookie": Any<Cookie>,
      "fn": Any<Function>,
      "inside": ObjectContaining {
        "url": Any<Function>,
      },
      "list": [
        Any<Function>,
        Any<Function>,
      ],
      "mock": Any<Function>,
      "number": Any<Number>,
      "response": Any<Response>,
      "stats": Any<Function>,
      "url": Any<Function>,
    }
  `);
  both(() => expect.any(URL)).toMatchInlineSnapshot(`Any<Function>`);
});
test("expect.any() of a class as a property matcher", () => {
  expect({ id: 1, url: new URL("http://localhost/") }).toMatchSnapshot({ url: expect.any(URL) });
  expect({ id: 1, url: new URL("http://localhost/") }).toMatchInlineSnapshot({ url: expect.any(URL) }, `
    {
      "id": 1,
      "url": Any<Function>,
    }
  `);
});
test("a class", () => {
  both(() => ({ URL, Buffer, Response, Cookie: Bun.Cookie, Stats, Map, mock: jest.fn() })).toMatchInlineSnapshot(`
    {
      "Buffer": [class Function],
      "Cookie": [class Cookie],
      "Map": [class Map],
      "Response": [class Response],
      "Stats": [class Function],
      "URL": [class Function],
      "mock": [class Function],
    }
  `);
});
test("the global of a node:vm context", () => {
  both(() => context({ b: 2, a: 1 })).toMatchInlineSnapshot(`NodeVMGlobalProxy {}`);
  both(() => ({ held: context({ a: 1 }), list: [context({})] })).toMatchInlineSnapshot(`
    {
      "held": NodeVMGlobalProxy {},
      "list": [
        NodeVMGlobalProxy {},
      ],
    }
  `);
});
test("the global of a node:vm context that is not contextified", () => {
  both(() => vm.runInContext("this", Object.assign(vm.createContext(vm.constants.DONT_CONTEXTIFY), { a: 1 }))).toMatchInlineSnapshot(`NodeVMGlobalProxy {}`);
});
test("each of them in one value", () => {
  both(() => ({ response: response(), any: expect.any(URL), global: context({ a: 1 }), URL })).toMatchInlineSnapshot(`
    {
      "URL": [class Function],
      "any": Any<Function>,
      "global": NodeVMGlobalProxy {},
      "response": Response (1 bytes) {
        ok: true,
        url: "",
        status: 201,
        statusText: "",
        headers: Headers {},
        redirected: false,
        bodyUsed: false,
        Blob (1 bytes)
      }Response {},
    }
  `);
});

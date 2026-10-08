// A header list is the array form of a headers argument: [name, value, name, value] or [[name, value], ...].
// A value slot can hold an array: one header line per element.
import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

describe("a header list does not write into an array that the caller keeps", () => {
  // A server can keep the array of a value slot in a constant and name the same header again in the same list.
  // The later value must not go into the constant, or every later response carries it.
  const THEME = "theme=light; Path=/";
  const LANG = "lang=en; Path=/";
  const users = ["alice", "bob", "carol"];
  type Respond = (res: any, kept: string[], sid: string) => void;

  // Answers one request per user with `respond`. Returns the Set-Cookie lines that each user received, and the
  // kept array as the last response left it.
  async function cookiesPerUser(respond: Respond, kept: string[] = [THEME, LANG]) {
    const errors: string[] = [];
    const server = createServer((req, res) => {
      try {
        respond(res, kept, `sid=${req.headers["x-user"]}`);
      } catch (error) {
        errors.push(String(error));
      }
      res.end();
    });
    try {
      await once(server.listen(0, "127.0.0.1"), "listening");
      const { port } = server.address() as AddressInfo;
      const received: string[][] = [];
      for (const user of users) {
        const response = await fetch(`http://127.0.0.1:${port}/`, { headers: { "x-user": user } });
        received.push(response.headers.getSetCookie());
        await response.arrayBuffer();
      }
      return { received, kept, errors };
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }
  const ownCookieOnly = { received: users.map(user => [THEME, LANG, `sid=${user}`]), kept: [THEME, LANG], errors: [] };

  // The `name` lines of the head that a ServerResponse with no socket wrote.
  function headLines(res: ServerResponse, name: string) {
    const head: string = (res as any).outputData.map((x: any) => String(x.data)).join("");
    return head
      .split("\r\n")
      .filter(line => line.startsWith(`${name}: `))
      .map(line => line.slice(name.length + 2));
  }

  describe("writeHead(), with the same result on Node.js v26.3.0", () => {
    const lists: [string, Respond][] = [
      ["a flat list", (res, kept, sid) => res.writeHead(200, ["Set-Cookie", kept, "Set-Cookie", sid])],
      [
        "a list of pairs",
        (res, kept, sid) =>
          res.writeHead(200, [
            ["Set-Cookie", kept],
            ["Set-Cookie", sid],
          ]),
      ],
      [
        "a status message, then a flat list",
        (res, kept, sid) => res.writeHead(200, "OK", ["Set-Cookie", kept, "Set-Cookie", sid]),
      ],
      [
        "a name repeated in another case",
        (res, kept, sid) => res.writeHead(200, ["Set-Cookie", kept, "set-cookie", sid]),
      ],
      [
        "an array value after the kept array",
        (res, kept, sid) => res.writeHead(200, ["Set-Cookie", kept, "Set-Cookie", [sid]]),
      ],
    ];
    test.each(lists)("%s", async (_name, respond) => {
      expect(await cookiesPerUser(respond)).toEqual(ownCookieOnly);
    });

    test("a frozen array in a flat list", async () => {
      const respond: Respond = (res, kept, sid) => res.writeHead(200, ["Set-Cookie", kept, "Set-Cookie", sid]);
      expect(await cookiesPerUser(respond, Object.freeze([THEME, LANG]) as string[])).toEqual(ownCookieOnly);
    });

    test.each(["Set-Cookie", "Link"])("a ServerResponse with no socket, %s", name => {
      const kept = [THEME, LANG];
      const received = users.map(user => {
        const res = new ServerResponse(new IncomingMessage(null as any));
        res.writeHead(200, [name, kept, name, `sid=${user}`]);
        res.end();
        return headLines(res, name);
      });
      expect({ received, kept, errors: [] }).toEqual(ownCookieOnly);
    });

    // Node renders the head inside writeHead(). A list value is fixed there, so a later push is not sent.
    const lateWrites: [string, (res: any, cookies: string[]) => void][] = [
      ["a flat list", (res, cookies) => res.writeHead(200, ["Set-Cookie", cookies])],
      ["a list of pairs", (res, cookies) => res.writeHead(200, [["Set-Cookie", cookies]])],
    ];
    test.each(lateWrites)("a value pushed after writeHead() with %s is not sent", async (_name, writeHead) => {
      const { received } = await cookiesPerUser((res, _kept, sid) => {
        const cookies = [THEME, LANG];
        writeHead(res, cookies);
        cookies.push(sid);
      });
      expect(received).toEqual(users.map(() => [THEME, LANG]));
    });
  });

  // Deliberate divergence from Node v26.3.0. With a header already set, Node merges a flat list into its header
  // store and appends to the caller's array there: the second user receives the cookie of the first user. In that
  // state Node takes no list of pairs at all (ERR_INVALID_ARG_TYPE, or ERR_INVALID_ARG_VALUE for an odd count).
  // Bun takes both forms and appends to a copy.
  describe("writeHead() after a header was set", () => {
    const lists: [string, Respond][] = [
      [
        "a flat list",
        (res, kept, sid) => {
          res.setHeader("X-Any", "1");
          res.writeHead(200, ["Set-Cookie", kept, "Set-Cookie", sid]);
        },
      ],
      [
        "a list of pairs",
        (res, kept, sid) => {
          res.setHeader("X-Any", "1");
          res.writeHead(200, [
            ["Set-Cookie", kept],
            ["Set-Cookie", sid],
          ]);
        },
      ],
      [
        "a list of pairs that names a header given to setHeader() as an array",
        (res, kept, sid) => {
          res.setHeader("Set-Cookie", kept);
          res.writeHead(200, [["Set-Cookie", sid]]);
        },
      ],
      [
        "a list of pairs that names a header given to appendHeader() as an array",
        (res, kept, sid) => {
          res.appendHeader("Set-Cookie", kept);
          res.writeHead(200, [["Set-Cookie", sid]]);
        },
      ],
    ];
    test.each(lists)("%s", async (_name, respond) => {
      expect(await cookiesPerUser(respond)).toEqual(ownCookieOnly);
    });

    test("a list of pairs that names a header given to setHeader() as an array, Link", () => {
      const kept = [THEME, LANG];
      const received = users.map(user => {
        const res = new ServerResponse(new IncomingMessage(null as any));
        res.setHeader("Link", kept);
        res.writeHead(200, [["Link", `sid=${user}`]]);
        res.end();
        return headLines(res, "Link");
      });
      expect({ received, kept, errors: [] }).toEqual(ownCookieOnly);
    });
  });

  // `res.headers =` is a Bun extension. Each form takes a copy of an array value.
  describe("res.headers =", () => {
    const forms: [string, Respond][] = [
      [
        "a list of pairs",
        (res, kept, sid) =>
          (res.headers = [
            ["Set-Cookie", kept],
            ["Set-Cookie", sid],
          ]),
      ],
      [
        "an object with entries()",
        (res, kept, sid) =>
          (res.headers = new Map<string, string | string[]>([
            ["Set-Cookie", kept],
            ["set-cookie", sid],
          ])),
      ],
      [
        "a plain object, then appendHeader()",
        (res, kept, sid) => {
          res.headers = { "Set-Cookie": kept };
          res.appendHeader("Set-Cookie", sid);
        },
      ],
    ];
    test.each(forms)("%s", async (_name, respond) => {
      expect(await cookiesPerUser(respond)).toEqual(ownCookieOnly);
    });
  });
});

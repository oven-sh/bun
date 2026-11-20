import { bunEnv, bunExe, tempDir } from "harness";
import { parse, urlToHttpOptions } from "url";

describe("Url.prototype.parse", () => {
  it("parses URL correctly", () => {
    const url = parse("https://foo:bar@baz.qat:8000/qux/quux?foo=bar&baz=12#qat");

    expect(url.hash).toEqual("#qat");
    expect(url.host).toEqual("baz.qat:8000");
    expect(url.hostname).toEqual("baz.qat");
    expect(url.href).toEqual("https://foo:bar@baz.qat:8000/qux/quux?foo=bar&baz=12#qat");
    expect(url.pathname).toEqual("/qux/quux");
    expect(url.port).toEqual("8000");
    expect(url.protocol).toEqual("https:");
    expect(url.search).toEqual("?foo=bar&baz=12");
  });

  it("accepts empty host", () => {
    expect(() => parse("http://")).not.toThrow();
  });

  it("accepts ipv6 host", () => {
    expect(parse("http://[::1]")).toEqual({
      protocol: "http:",
      slashes: true,
      auth: null,
      host: "[::1]",
      port: null,
      hostname: "::1",
      hash: null,
      search: null,
      query: null,
      pathname: "/",
      path: "/",
      href: "http://[::1]/",
    });
  });

  it("handles punycode", () => {
    expect(parse("http://xn--xample-hva.com")).toEqual({
      protocol: "http:",
      slashes: true,
      auth: null,
      host: "xn--xample-hva.com",
      port: null,
      hostname: "xn--xample-hva.com",
      hash: null,
      search: null,
      query: null,
      pathname: "/",
      path: "/",
      href: "http://xn--xample-hva.com/",
    });
    expect(parse("http://💥.net")).toEqual({
      protocol: "http:",
      slashes: true,
      auth: null,
      host: "xn--hs8h.net",
      port: null,
      hostname: "xn--hs8h.net",
      hash: null,
      search: null,
      query: null,
      pathname: "/",
      path: "/",
      href: "http://xn--hs8h.net/",
    });
  });
});

it("urlToHttpOptions returns a null-prototype object", () => {
  const options = urlToHttpOptions(new URL("http://user:pass@foo.bar.com:21/aaa/zzz?l=24#test"));
  expect(Object.getPrototypeOf(options)).toBe(null);
  expect<object>({ ...options }).toEqual({
    protocol: "http:",
    hostname: "foo.bar.com",
    hash: "#test",
    search: "?l=24",
    pathname: "/aaa/zzz",
    path: "/aaa/zzz?l=24",
    href: "http://user:pass@foo.bar.com:21/aaa/zzz?l=24#test",
    port: 21,
    auth: "user:pass",
  });
});

it("URL constructor throws ERR_MISSING_ARGS", () => {
  var err;
  try {
    // @ts-expect-error
    new URL();
  } catch (e) {
    err = e;
  }

  expect(err?.code).toEqual("ERR_MISSING_ARGS");
});

// https://github.com/oven-sh/bun/issues/16705
it("#16705", () => {
  expect(Bun.fileURLToPath("file://C:/firebase-gen-%7B%7B%20firebase.gen%20%7D%7D")).toEqual(
    process.platform === "win32" ? "C:\\firebase-gen-{{ firebase.gen }}" : "/C:/firebase-gen-{{ firebase.gen }}",
  );
});

// url.parse() warns once, and not for a call from a package. Node decides that natively, whatever Error.stackTraceLimit
// and Error.prepareStackTrace are (src/node_util.cc IsInsideNodeModules). Node.js v26.3.0 prints the same for every row.
// The last row passes without the native capture too: the helper kept the Error.captureStackTrace that it found when it was loaded.
it.concurrent.each([
  [
    "Error.stackTraceLimit is 0 and not writable",
    `Object.defineProperty(Error, "stackTraceLimit", { value: 0, writable: false });`,
  ],
  [
    "Error.stackTraceLimit is a string and not writable",
    `Object.defineProperty(Error, "stackTraceLimit", { value: "x", writable: false });`,
  ],
  [
    "Error.prepareStackTrace is not writable",
    `Object.defineProperty(Error, "prepareStackTrace", { value: undefined, writable: false });`,
  ],
  ["Error is frozen", `Object.freeze(Error);`],
  [
    "Error.captureStackTrace is a function of the program",
    `Error.captureStackTrace = () => { throw new RangeError("thrown by the program"); };`,
  ],
])("url.parse() from a package emits no DEP0169 when %s", async (_, setup) => {
  using dir = tempDir("url-parse-from-a-package", {
    "node_modules/pkg/index.js": `module.exports = url => require("node:url").parse(url).hostname;`,
    "main.cjs": `
      const url = require("node:url");
      const warnings = [];
      process.on("warning", warning => warnings.push(warning.code));
      // process.emitWarning() emits on the next tick, so a tick queued after it runs after the event.
      const tick = () => new Promise(resolve => process.nextTick(resolve));
      (async () => {
        ${setup}
        const hostname = require("pkg")("http://example.com/a");
        await tick();
        const afterThePackage = [...warnings];
        url.parse("http://example.com/b");
        await tick();
        console.log(JSON.stringify({ hostname, afterThePackage, afterTheProgram: warnings }));
      })();
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.cjs"],
    env: { ...bunEnv, NODE_NO_WARNINGS: "1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr }).toEqual({
    stdout: JSON.stringify({ hostname: "example.com", afterThePackage: [], afterTheProgram: ["DEP0169"] }),
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

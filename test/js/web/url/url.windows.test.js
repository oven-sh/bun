import { isWindows } from "harness";

const { fileURLToPath, pathToFileURL } = require("url");

function checkURL(url, spec) {
  expect(url.href).toBe(spec.href);
  expect(url.origin).toBe(spec.origin);
  expect(url.protocol).toBe(spec.protocol);
  expect(url.username).toBe(spec.username);
  expect(url.password).toBe(spec.password);
  expect(url.host).toBe(spec.host);
  expect(url.hostname).toBe(spec.hostname);
  expect(url.port).toBe(spec.port);
  expect(url.pathname).toBe(spec.pathname);
  expect(url.search).toBe(spec.search);
  expect(url.hash).toBe(spec.hash);
}

describe("new URL", () => {
  test.if(isWindows)("basic", () => {
    const url = new URL("file://C:/Users/windo/Code/Test/hello.mjs");
    checkURL(url, {
      href: "file:///C:/Users/windo/Code/Test/hello.mjs",
      origin: "null",
      protocol: "file:",
      username: "",
      password: "",
      host: "",
      hostname: "",
      port: "",
      pathname: "/C:/Users/windo/Code/Test/hello.mjs",
      search: "",
      hash: "",
    });
  });
  test.if(isWindows)("three slashes", () => {
    const url = new URL("file:///C:/Users/windo/Code/Test/hello.mjs");
    checkURL(url, {
      href: "file:///C:/Users/windo/Code/Test/hello.mjs",
      origin: "null",
      protocol: "file:",
      username: "",
      password: "",
      host: "",
      hostname: "",
      port: "",
      pathname: "/C:/Users/windo/Code/Test/hello.mjs",
      search: "",
      hash: "",
    });
  });
  test.if(isWindows)("four slashes", () => {
    const url = new URL("file:////C:/Users/windo/Code/Test/hello.mjs");
    checkURL(url, {
      href: "file:////C:/Users/windo/Code/Test/hello.mjs",
      origin: "null",
      protocol: "file:",
      username: "",
      password: "",
      host: "",
      hostname: "",
      port: "",
      pathname: "//C:/Users/windo/Code/Test/hello.mjs",
      search: "",
      hash: "",
    });
  });
  test.if(isWindows)("normalization", () => {
    const url = new URL("file:///C:/Users/windo\\Code//Test/hello.mjs");
    checkURL(url, {
      href: "file:///C:/Users/windo/Code//Test/hello.mjs",
      origin: "null",
      protocol: "file:",
      username: "",
      password: "",
      host: "",
      hostname: "",
      port: "",
      pathname: "/C:/Users/windo/Code//Test/hello.mjs",
      search: "",
      hash: "",
    });
  });
  test.if(isWindows)("unc", () => {
    const url = new URL("file://server/share");
    checkURL(url, {
      href: "file://server/share",
      origin: "null",
      protocol: "file:",
      username: "",
      password: "",
      host: "server",
      hostname: "server",
      port: "",
      pathname: "/share",
      search: "",
      hash: "",
    });
  });
  test.if(isWindows)("unc with path", () => {
    const url = new URL("file://server/share/etc");
    checkURL(url, {
      href: "file://server/share/etc",
      origin: "null",
      protocol: "file:",
      username: "",
      password: "",
      host: "server",
      hostname: "server",
      port: "",
      pathname: "/share/etc",
      search: "",
      hash: "",
    });
  });
});

describe("fileURLToPath", () => {
  test.if(isWindows)("basic", () => {
    const path = fileURLToPath(new URL("file:///C:/Users/windo/Code/Test/hello.mjs"));
    expect(path).toBe("C:\\Users\\windo\\Code\\Test\\hello.mjs");
  });
  test.if(isWindows)("unc", () => {
    const path = fileURLToPath(new URL("file://server/share"));
    expect(path).toBe("\\\\server\\share");
  });
  test.if(isWindows)("unc with path", () => {
    const path = fileURLToPath(new URL("file://server/share/etc"));
    expect(path).toBe("\\\\server\\share\\etc");
  });
  test.if(isWindows)("emoji", () => {
    const path = fileURLToPath(new URL("file:///C:/dev/%F0%9F%98%82"));
    expect(path).toBe("C:\\dev\\😂");
  });
  test.if(isWindows)("unc emoji", () => {
    const path = fileURLToPath(new URL("file://server/share/%F0%9F%98%82"));
    expect(path).toBe("\\\\server\\share\\😂");
  });
});

describe("pathToFileURL", () => {
  test.if(isWindows)("basic", () => {
    const url = pathToFileURL("C:\\Users\\windo\\Code\\Test\\hello.mjs");
    checkURL(url, {
      href: "file:///C:/Users/windo/Code/Test/hello.mjs",
      origin: "null",
      protocol: "file:",
      username: "",
      password: "",
      host: "",
      hostname: "",
      port: "",
      pathname: "/C:/Users/windo/Code/Test/hello.mjs",
      search: "",
      hash: "",
    });
  });
  test.if(isWindows)("unc", () => {
    const url = pathToFileURL("\\\\server\\share");
    checkURL(url, {
      href: "file://server/share",
      origin: "null",
      protocol: "file:",
      username: "",
      password: "",
      host: "server",
      hostname: "server",
      port: "",
      pathname: "/share",
      search: "",
      hash: "",
    });
  });
  test.if(isWindows)("unc with path", () => {
    const url = pathToFileURL("\\\\server\\share\\etc");
    checkURL(url, {
      href: "file://server/share/etc",
      origin: "null",
      protocol: "file:",
      username: "",
      password: "",
      host: "server",
      hostname: "server",
      port: "",
      pathname: "/share/etc",
      search: "",
      hash: "",
    });
  });
  test.if(isWindows)("emoji", () => {
    const url = pathToFileURL("C:\\dev\\😂");
    checkURL(url, {
      href: "file:///C:/dev/%F0%9F%98%82",
      origin: "null",
      protocol: "file:",
      username: "",
      password: "",
      host: "",
      hostname: "",
      port: "",
      pathname: "/C:/dev/%F0%9F%98%82",
      search: "",
      hash: "",
    });
  });
  test.if(isWindows)("unc emoji", () => {
    const url = pathToFileURL("\\\\server\\share\\😂");
    checkURL(url, {
      href: "file://server/share/%F0%9F%98%82",
      origin: "null",
      protocol: "file:",
      username: "",
      password: "",
      host: "server",
      hostname: "server",
      port: "",
      pathname: "/share/%F0%9F%98%82",
      search: "",
      hash: "",
    });
  });
});

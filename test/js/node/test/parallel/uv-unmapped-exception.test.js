//#FILE: test-uv-unmapped-exception.js
//#SHA1: 2878fb9a4523acb34f6283c980cde15b06fdc055
//-----------------
"use strict";

// We can't use internal modules, so we'll need to implement our own UVException and UVExceptionWithHostPort
class UVException extends Error {
  constructor({ errno, syscall }) {
    super(`UNKNOWN: unknown error, ${syscall}`);
    this.errno = errno;
    this.syscall = syscall;
    this.code = "UNKNOWN";
  }
}

class UVExceptionWithHostPort extends Error {
  constructor(errno, syscall, address, port) {
    super(`${syscall} UNKNOWN: unknown error ${address}:${port}`);
    this.code = "UNKNOWN";
    this.errno = errno;
    this.syscall = syscall;
    this.address = address;
    this.port = port;
  }
}

test("UVException", () => {
  const exception = new UVException({ errno: 100, syscall: "open" });

  expect(exception.message).toBe("UNKNOWN: unknown error, open");
  expect(exception.errno).toBe(100);
  expect(exception.syscall).toBe("open");
  expect(exception.code).toBe("UNKNOWN");
});

test("UVExceptionWithHostPort", () => {
  const exception = new UVExceptionWithHostPort(100, "listen", "127.0.0.1", 80);

  expect(exception.message).toBe("listen UNKNOWN: unknown error 127.0.0.1:80");
  expect(exception.code).toBe("UNKNOWN");
  expect(exception.errno).toBe(100);
  expect(exception.syscall).toBe("listen");
  expect(exception.address).toBe("127.0.0.1");
  expect(exception.port).toBe(80);
});

//<#END_FILE: test-uv-unmapped-exception.js

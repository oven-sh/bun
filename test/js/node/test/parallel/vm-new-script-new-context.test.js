//#FILE: test-vm-new-script-new-context.js
//#SHA1: 444a86a44203350903ab84a30de39e24a28732ec
//-----------------
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";

const { Script } = require("vm");

test("Script runInNewContext returns expected result", () => {
  const script = new Script("'passed';");
  const result1 = script.runInNewContext();
  const result2 = script.runInNewContext();
  expect(result1).toBe("passed");
  expect(result2).toBe("passed");
});

test("Script throws error when expected", () => {
  const script = new Script("throw new Error('test');");
  expect(() => {
    script.runInNewContext();
  }).toThrow(
    expect.objectContaining({
      name: "Error",
      message: expect.any(String),
    }),
  );
});

test("Script throws ReferenceError for undefined variable", () => {
  const script = new Script("foo.bar = 5;");
  expect(() => {
    script.runInNewContext();
  }).toThrow(
    expect.objectContaining({
      name: "ReferenceError",
      message: expect.any(String),
    }),
  );
});

test("Script does not affect global scope", () => {
  global.hello = 5;
  const script = new Script("hello = 2");
  script.runInNewContext();
  expect(global.hello).toBe(5);

  // Cleanup
  delete global.hello;
});

test("Script runs in new context with provided object", () => {
  global.code = "foo = 1;" + "bar = 2;" + "if (baz !== 3) throw new Error('test fail');";
  global.foo = 2;
  global.obj = { foo: 0, baz: 3 };
  const script = new Script(global.code);
  script.runInNewContext(global.obj);
  expect(global.obj.foo).toBe(1);
  expect(global.obj.bar).toBe(2);
  expect(global.foo).toBe(2);

  // cleanup
  delete global.code;
  delete global.foo;
  delete global.obj;
});

test("Script can modify global scope through provided function", () => {
  const script = new Script("f()");
  function changeFoo() {
    global.foo = 100;
  }
  script.runInNewContext({ f: changeFoo });
  expect(global.foo).toBe(100);

  // cleanup
  delete global.foo;
});

test("Script modifies provided object and throws when object is not provided", () => {
  const script = new Script("f.a = 2");
  const f = { a: 1 };
  script.runInNewContext({ f });
  expect(f.a).toBe(2);

  expect(() => {
    script.runInNewContext();
  }).toThrow(
    expect.objectContaining({
      name: "ReferenceError",
      message: expect.any(String),
    }),
  );
});

test("Script.runInNewContext throws when called with invalid this", () => {
  const script = new Script("");
  expect(() => {
    script.runInNewContext.call("'hello';");
  }).toThrow(
    expect.objectContaining({
      name: "TypeError",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-vm-new-script-new-context.js

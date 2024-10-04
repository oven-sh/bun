//#FILE: test-process-exit.js
//#SHA1: 6b66cdd7fd70fedb0fab288294724b6ffe7df8c9
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

test('Calling .exit() from within "exit" should not overflow the call stack', () => {
  let nexits = 0;

  const exitHandler = jest.fn(code => {
    expect(nexits++).toBe(0);
    expect(code).toBe(0);
    process.exit();
  });

  process.on("exit", exitHandler);

  // Simulate process exit
  process.emit("exit", 0);

  expect(exitHandler).toHaveBeenCalledTimes(1);
});

// "exit" should be emitted unprovoked

//<#END_FILE: test-process-exit.js

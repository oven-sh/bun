//#FILE: test-child-process-double-pipe.js
//#SHA1: cdc35246587597f0e45244d5e25a2e1f2014de17
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
const os = require("os");
const spawn = require("child_process").spawn;
const debug = require("util").debuglog("test");

const isWindows = process.platform === "win32";

// We're trying to reproduce:
// $ echo "hello\nnode\nand\nworld" | grep o | sed s/o/a/

let grep, sed, echo;

if (isWindows) {
  grep = spawn("grep", ["--binary", "o"]);
  sed = spawn("sed", ["--binary", "s/o/O/"]);
  echo = spawn("cmd.exe", ["/c", "echo", "hello&&", "echo", "node&&", "echo", "and&&", "echo", "world"]);
} else {
  grep = spawn("grep", ["o"]);
  sed = spawn("sed", ["s/o/O/"]);
  echo = spawn("echo", ["hello\nnode\nand\nworld\n"]);
}

// If the spawn function leaks file descriptors to subprocesses, grep and sed
// hang.
// This happens when calling pipe(2) and then forgetting to set the
// FD_CLOEXEC flag on the resulting file descriptors.
//
// This test checks child processes exit, meaning they don't hang like
// explained above.

test("child process double pipe", async () => {
  const echoExitPromise = new Promise(resolve => {
    echo.on("exit", resolve);
  });

  const grepExitPromise = new Promise(resolve => {
    grep.on("exit", resolve);
  });

  const sedExitPromise = new Promise(resolve => {
    sed.on("exit", resolve);
  });

  // pipe echo | grep
  echo.stdout.on("data", data => {
    debug(`grep stdin write ${data.length}`);
    if (!grep.stdin.write(data)) {
      echo.stdout.pause();
    }
  });

  // TODO(@jasnell): This does not appear to ever be
  // emitted. It's not clear if it is necessary.
  grep.stdin.on("drain", () => {
    echo.stdout.resume();
  });

  // Propagate end from echo to grep
  echo.stdout.on("end", () => {
    grep.stdin.end();
  });

  // pipe grep | sed
  grep.stdout.on("data", data => {
    debug(`grep stdout ${data.length}`);
    if (!sed.stdin.write(data)) {
      grep.stdout.pause();
    }
  });

  // TODO(@jasnell): This does not appear to ever be
  // emitted. It's not clear if it is necessary.
  sed.stdin.on("drain", () => {
    grep.stdout.resume();
  });

  // Propagate end from grep to sed
  grep.stdout.on("end", () => {
    debug("grep stdout end");
    sed.stdin.end();
  });

  let result = "";

  // print sed's output
  sed.stdout.on("data", data => {
    result += data.toString("utf8", 0, data.length);
    debug(data);
  });

  await Promise.all([echoExitPromise, grepExitPromise, sedExitPromise]);

  expect(result).toBe(`hellO${os.EOL}nOde${os.EOL}wOrld${os.EOL}`);
});

//<#END_FILE: test-child-process-double-pipe.js

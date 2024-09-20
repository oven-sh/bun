//#FILE: test-fs-read-stream-fd-leak.js
//#SHA1: fc07b42f524d6a2f9743a5a7665c92096f58505b
//-----------------
"use strict";

const fs = require("fs");
const path = require("path");

let openCount = 0;
const _fsopen = fs.open;
const _fsclose = fs.close;

const loopCount = 50;
const totalCheck = 50;
const emptyTxt = path.join(__dirname, "../fixtures/empty.txt");

fs.open = function () {
  openCount++;
  return _fsopen.apply(null, arguments);
};

fs.close = function () {
  openCount--;
  return _fsclose.apply(null, arguments);
};

function testLeak(endFn) {
  return new Promise(resolve => {
    console.log(`testing for leaks from fs.createReadStream().${endFn}()...`);

    let i = 0;
    let check = 0;

    function checkFunction() {
      if (openCount !== 0 && check < totalCheck) {
        check++;
        setTimeout(checkFunction, 100);
        return;
      }

      expect(openCount).toBe(0);
      openCount = 0;
      resolve();
    }

    const interval = setInterval(() => {
      const s = fs.createReadStream(emptyTxt);
      s[endFn]();

      if (++i === loopCount) {
        clearInterval(interval);
        setTimeout(checkFunction, 100);
      }
    }, 2);
  });
}

test("no leaked file descriptors using close()", async () => {
  await testLeak("close");
}, 10000);

test("no leaked file descriptors using destroy()", async () => {
  await testLeak("destroy");
}, 10000);

//<#END_FILE: test-fs-read-stream-fd-leak.js

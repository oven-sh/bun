//#FILE: test-https-server-connections-checking-leak.js
//#SHA1: 7c1f4c81ff1759c1c3812f14713bd14179e109e3
//-----------------
"use strict";

// Flags: --expose-gc

// Check that creating a server without listening does not leak resources.

if (typeof process !== "undefined" && process.versions && !process.versions.bun) {
  const common = require("../common");
  if (!common.hasCrypto) {
    common.skip("missing crypto");
  }
}

const https = require("https");
const max = 100;

let gcCount = 0;

function onGC(obj, options) {
  const ongc = options.ongc;
  const handle = new WeakRef(obj);

  function check() {
    if (handle.deref() === undefined) {
      ongc();
    } else {
      setImmediate(check);
    }
  }

  setImmediate(check);
}

test("https server creation does not leak resources", () => {
  const countdown = jest.fn();

  for (let i = 0; i < max; i++) {
    const server = https.createServer((req, res) => {});
    onGC(server, {
      ongc: () => {
        countdown();
        gcCount++;
      },
    });
  }

  return new Promise(resolve => {
    function checkGC() {
      if (typeof gc !== "undefined") {
        gc();
      }

      if (gcCount === max) {
        expect(countdown).toHaveBeenCalledTimes(max);
        resolve();
      } else {
        setImmediate(checkGC);
      }
    }

    setImmediate(checkGC);
  });
}, 30000); // Increased timeout to allow for multiple GC cycles

//<#END_FILE: test-https-server-connections-checking-leak.js

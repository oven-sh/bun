//#FILE: test-timers-args.js
//#SHA1: 27f971d534c9bb3a1c14ae176ee8f34b0cdbed6f
//-----------------
"use strict";

function range(n) {
  return "x"
    .repeat(n + 1)
    .split("")
    .map(function (_, i) {
      return i;
    });
}

test("setTimeout with increasing number of arguments", done => {
  function timeout(nargs) {
    const args = range(nargs);
    setTimeout(callback, 1, ...args);

    function callback(...receivedArgs) {
      expect(receivedArgs).toEqual(args);
      if (nargs < 128) {
        timeout(nargs + 1);
      } else {
        done();
      }
    }
  }

  timeout(0);
});

test("setInterval with increasing number of arguments", done => {
  function interval(nargs) {
    const args = range(nargs);
    const timer = setInterval(callback, 1, ...args);

    function callback(...receivedArgs) {
      clearInterval(timer);
      expect(receivedArgs).toEqual(args);
      if (nargs < 128) {
        interval(nargs + 1);
      } else {
        done();
      }
    }
  }

  interval(0);
});

//<#END_FILE: test-timers-args.js

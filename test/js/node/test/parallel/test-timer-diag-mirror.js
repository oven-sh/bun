'use strict';
// Flags: --expose-gc
// Diagnostic mirror of test-primitive-timer-leak.js with observable phases.
// Bounded: prints PARTIAL and exits 0 at poll 100 so it never fails a lane;
// the log lines are the deliverable.
require('../common');
const { onGC } = require('../common/gc');

let fired = 0;
let count = 0;
const poller = setInterval(() => {
  globalThis.gc();
  console.log(`POLL fired=${fired} collected=${count}`);
  if (poller._pollN === undefined) poller._pollN = 0;
  if (++poller._pollN >= 100) {
    console.log(`PARTIAL ${count}/10 fired=${fired}`);
    process.exit(0);
  }
}, 100);

for (let i = 0; i < 10; i++) {
  const timer = setTimeout(() => { fired++; console.log('FIRED ' + fired); }, 0);
  onGC(timer, {
    ongc: () => {
      if (++count === 10) {
        console.log('ALL_ONGC');
        clearInterval(poller);
      }
    }
  });
  console.log('CREATED ' + +timer);
}

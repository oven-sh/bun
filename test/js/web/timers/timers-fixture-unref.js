const { mustCall } = require("../../node/test/common");

var setTimer;
if (process.argv[2] === "setTimeout") {
  setTimer = setTimeout;
} else if (process.argv[2] === "setInterval") {
  setTimer = setInterval;
} else {
  throw new Error("Invalid process argument: " + process.argv[2]);
}

{
  const interval = setTimer(
    mustCall(() => {
      clearTimeout(interval);
    }),
    1,
  ).unref();
}

{
  const interval = setTimer(
    mustCall(() => {
      interval.close();
    }),
    1,
  ).unref();
}

{
  const interval = setTimer(
    mustCall(() => {
      clearInterval(interval);
    }),
    1,
  ).unref();
}

{
  const interval = setTimer(
    mustCall(() => {
      interval._idleTimeout = -1;
    }),
    1,
  ).unref();
}

{
  const interval = setTimer(
    mustCall(() => {
      interval._idleTimeout = -1;
      interval.refresh();
    }),
  );
}

// refresh is called before _idleTimeout is set to -1
// giving the timer a chance to reschedule once before
// -1 has an effect
{
  const interval = setTimer(
    mustCall(() => {
      interval.refresh();
      interval._idleTimeout = -1;
    }, 2),
  );
}

{
  const interval = setTimer(
    mustCall(() => {
      interval._onTimeout = null;
    }),
    1,
  ).unref();
}

// Use timers' intrinsic behavior to keep this open
// exactly long enough for the problem to manifest.
//
// See https://github.com/nodejs/node/issues/9561
//
// Since this is added after it will always fire later
// than the previous timeouts, unrefed or not.
//
// Keep the event loop alive for one timeout and then
// another. Any problems will occur when the second
// should be called but before it is able to be.
setTimeout(
  mustCall(() => {
    setTimeout(mustCall(), 1);
  }),
  1,
);

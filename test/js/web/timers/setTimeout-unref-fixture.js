// Arms every ref/unref scenario at once. The ref'd timers must run, the unref'd ones must
// not run and must not keep the process alive: once the ref'd timers are done the event
// loop has to wind down by itself. The exit handler reports how often each callback ran;
// setTimeout.test.js asserts the exact report. An unref'd timer that wrongly keeps the
// loop alive fires 100ms later and shows up in the report as a non-zero count.
const ran = {
  "unref()": 0,
  "ref().unref()": 0,
  "unref().ref()": 0,
  "refresh() inside the callback": 0,
  "this is the Timeout": 0,
  "callback returning a pending promise": 0,
  "unref'd callback returning a pending promise": 0,
};

const unrefd = setTimeout(() => ran["unref()"]++, 100);
if (unrefd.unref() !== unrefd) throw new Error("unref() must return the timer");

const reffed = setTimeout(() => ran["ref().unref()"]++, 100);
if (reffed.ref() !== reffed) throw new Error("ref() must return the timer");
reffed.unref();

setTimeout(() => ran["unref().ref()"]++, 1)
  .unref()
  .ref();

// refresh() from inside the callback re-arms the one-shot timer once, so it runs twice.
const refreshing = setTimeout(() => {
  if (++ran["refresh() inside the callback"] === 1) refreshing.refresh();
}, 1);

const self = setTimeout(function () {
  if (this === self) ran["this is the Timeout"]++;
}, 1);

// A never-settling promise returned from the callback must not keep the loop alive.
setTimeout(() => {
  ran["callback returning a pending promise"]++;
  return new Promise(() => {});
}, 1);

// The ref'd 1ms timers above keep the loop alive long enough for this one to fire too.
setTimeout(() => {
  ran["unref'd callback returning a pending promise"]++;
  return new Promise(() => {});
}, 1).unref();

process.on("exit", () => console.log(JSON.stringify(ran)));

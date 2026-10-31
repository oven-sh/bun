const controller = new AbortController();
let heard = "";
controller.signal.addEventListener("abort", () => {
  heard = String(controller.signal.reason);
});
controller.abort(new Error("stop"));
console.log(
  controller.signal.aborted,
  heard,
  AbortSignal.abort().aborted,
  AbortSignal.any([controller.signal]).aborted,
);
// The timer of a timeout signal keeps no process alive, so an interval does while this waits for it.
const whileTheSignalWaits = setInterval(() => {}, 1000);
const timed = AbortSignal.timeout(5);
await new Promise(resolve => timed.addEventListener("abort", resolve));
clearInterval(whileTheSignalWaits);
console.log(timed.reason.name, new Request("http://x/", { signal: controller.signal }).signal.aborted);
try {
  controller.signal.throwIfAborted();
} catch (error: any) {
  console.log(error.message);
}

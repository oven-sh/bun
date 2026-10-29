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
const timed = AbortSignal.timeout(5);
await new Promise(resolve => timed.addEventListener("abort", resolve));
console.log(timed.reason.name, new Request("http://x/", { signal: controller.signal }).signal.aborted);
try {
  controller.signal.throwIfAborted();
} catch (error: any) {
  console.log(error.message);
}

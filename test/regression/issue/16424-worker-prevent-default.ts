// Worker that handles errors via addEventListener + preventDefault()
self.addEventListener("error", e => {
  e.preventDefault();
});

postMessage("before-error");

setTimeout(() => {
  throw new Error("test error");
}, 50);

setTimeout(() => {
  postMessage("after-error");
}, 200);

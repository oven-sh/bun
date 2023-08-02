var bc = new BroadcastChannel("sleep");
bc.onmessage = function (e) {
  bc.postMessage("done!");
};

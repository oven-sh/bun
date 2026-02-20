// Worker that does NOT handle errors — should terminate
setTimeout(() => {
  throw new Error("unhandled test error");
}, 50);

const order = [];
const report = () => {
  if (order.length === 2) postMessage(order);
};

setTimeout(() => {
  order.push("timeout");
  report();
}, 1);
setImmediate(() => {
  order.push("immediate");
  report();
});

// Block past the 1ms deadline so the timer is expired before the worker's event
// loop is entered.
const start = Date.now();
while (Date.now() - start < 10) {}

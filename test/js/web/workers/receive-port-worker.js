onmessage = e => {
  if (e.data instanceof MessagePort) {
    const port = e.data;
    port.onmessage = e => {
      port.postMessage("done!");
    };
    port.postMessage("received port!");
  }
};

declare var self: Worker;

self.postMessage("initial message");
self.onmessage = ({ data }) => {
  self.postMessage({
    received: data,
  });
};

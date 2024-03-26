declare var self: Worker;

const msg: string = "initial message";
self.postMessage(msg);
self.onmessage = ({ data }) => {
  self.postMessage({
    received: data,
  });
};

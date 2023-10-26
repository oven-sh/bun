const channel = new MessageChannel();
channel.port1.onmessage = () => {
  channel.port1.postMessage("done!");
};

postMessage(channel.port2, { transfer: [channel.port2] });

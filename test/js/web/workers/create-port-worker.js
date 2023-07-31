var channel = new MessageChannel();
channel.port1.onmessage = e => {
  channel.port1.postMessage("done!");
};

postMessage(channel.port2, { transfer: [channel.port2] });

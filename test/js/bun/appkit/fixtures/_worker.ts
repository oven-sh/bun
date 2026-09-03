postMessage("pong");
self.onmessage = e => postMessage(e.data);

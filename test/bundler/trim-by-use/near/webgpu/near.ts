const machine = { gpu: "none", usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC };
console.log(machine.gpu, machine.usage, navigator.userAgent.startsWith("Bun"), navigator.hardwareConcurrency > 0);

// Classes of WebGPU extend EventTarget, Event and DOMException.
const { port1, port2 } = new MessageChannel();
port1.addEventListener("message", event => {
  console.log(event.data, event.composedPath()[0] === port1, AbortSignal.abort().reason.name);
  port1.close();
});
port1.start();
port2.postMessage(machine);

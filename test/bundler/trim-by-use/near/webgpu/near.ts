const machine = { gpu: "none", usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC };
console.log(machine.gpu, machine.usage, navigator.userAgent.startsWith("Bun"), navigator.hardwareConcurrency > 0);

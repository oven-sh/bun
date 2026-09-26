// Preloaded into verdaccio when the harness hosts it on node (`VerdaccioRegistry.start`).
// Node 26 removed `SlowBuffer`. verdaccio -> jwa -> buffer-equal-constant-time reads
// `SlowBuffer.prototype` at load time, so verdaccio exits before it listens without this alias.
const buffer = require("node:buffer");
buffer.SlowBuffer ??= buffer.Buffer;

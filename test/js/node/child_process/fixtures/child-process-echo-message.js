// Sends the first IPC message back to the parent, then closes the channel so the process can exit.
process.once("message", message => {
  process.send(message, () => process.disconnect());
});

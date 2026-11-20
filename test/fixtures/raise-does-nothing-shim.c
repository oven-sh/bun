// LD_PRELOAD shim: raise() does nothing and reports success, as if the kernel
// had dropped the signal. The kernel does that for a signal whose action is the
// default one when the process is the first one of a PID namespace.
// Compiled by `raiseDoesNothing` in test/harness.ts.
int raise(int sig) {
  (void)sig;
  return 0;
}

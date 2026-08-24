// Calls back into bun from inside this shared object, so that a crash raised by
// the callback has a frame of this object in its trace. The crash handler's
// frame-pointer walk reads the return address into `call_through` out of the
// callback's frame: the test compiles this with -fno-omit-frame-pointer, and the
// value returned after the call keeps the compiler from turning it into a tail
// call (which would leave no frame to find).
typedef void (*callback_t)(void);

int call_through(callback_t callback) {
  callback();
  return 42;
}

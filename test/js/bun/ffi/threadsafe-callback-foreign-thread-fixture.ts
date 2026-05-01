// Invokes a threadsafe JSCallback from real OS threads to exercise
// FFI_Callback_threadsafe_call() on a thread that is not holding the VM's
// API lock. Before the fix, the lambda posted to the JS thread captured the
// FFICallbackFunctionWrapper by value, copy-constructing its JSC::Strong<>
// members on the foreign thread and corrupting the VM's HandleSet free list
// and strong list.
//
// We run batches of THREADS_PER_BATCH pthreads at a time. The pthreads in a
// batch race *each other* inside HandleSet::allocate() / writeBarrier(),
// which reliably trips the SentinelLinkedList / HandleSet debug assertions
// well before BATCHES is exhausted.
import { JSCallback, dlopen, ptr } from "bun:ffi";

const pthreadSymbols = {
  pthread_create: {
    // int pthread_create(pthread_t*, const pthread_attr_t*, void* (*)(void*), void*)
    args: ["ptr", "ptr", "ptr", "ptr"],
    returns: "i32",
  },
  pthread_join: {
    // int pthread_join(pthread_t, void**)
    args: ["u64", "ptr"],
    returns: "i32",
  },
} as const;

function openPthread() {
  const candidates =
    process.platform === "darwin"
      ? ["/usr/lib/libSystem.B.dylib", "libc.dylib"]
      : ["libc.so.6", "libpthread.so.0", "/usr/lib/libc.so"];
  let lastErr: unknown;
  for (const lib of candidates) {
    try {
      return dlopen(lib, pthreadSymbols);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

const { symbols } = openPthread();

const BATCHES = 256;
const THREADS_PER_BATCH = 8;
const TOTAL = BATCHES * THREADS_PER_BATCH;

let received = 0;

// The generated trampoline for this callback has the C signature
// `void my_callback_function(void*)`. Passing it as a pthread start routine
// (void* (*)(void*)) leaves the return value register unset, which is
// harmless because we never read the thread's return value via pthread_join.
const cb = new JSCallback(
  (_arg: number) => {
    received++;
  },
  {
    threadsafe: true,
    args: ["ptr"],
    returns: "void",
  },
);

const tids = new BigUint64Array(THREADS_PER_BATCH);
const tidBufs: Uint8Array[] = [];
for (let i = 0; i < THREADS_PER_BATCH; i++) tidBufs.push(new Uint8Array(8));

for (let batch = 0; batch < BATCHES; batch++) {
  for (let i = 0; i < THREADS_PER_BATCH; i++) {
    const rc = symbols.pthread_create(ptr(tidBufs[i]), null, cb.ptr, null);
    if (rc !== 0) throw new Error(`pthread_create failed: ${rc}`);
    tids[i] = new DataView(tidBufs[i].buffer).getBigUint64(0, true);
  }
  for (let i = 0; i < THREADS_PER_BATCH; i++) {
    const rc = symbols.pthread_join(tids[i], null);
    if (rc !== 0) throw new Error(`pthread_join failed: ${rc}`);
  }
}

// Every pthread has now returned from FFI_Callback_threadsafe_call(), so all
// tasks have been posted. Yield to the event loop until they have all run.
const keepAlive = setInterval(() => {}, 1_000);
while (received < TOTAL) {
  await new Promise<void>(resolve => setImmediate(resolve));
}
clearInterval(keepAlive);

cb.close();

if (received !== TOTAL) throw new Error(`expected ${TOTAL} callbacks, got ${received}`);
console.log("ok", received);

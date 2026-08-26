// Raises an Objective-C exception with nothing to catch it. Nothing in
// bun:appkit does this on purpose; the point is that the process ends as it
// does on an uncaught JavaScript error (the exception named on stderr, exit
// code 1), not with a crash report.
//
// Argument: "main" (default), an NSException raised on the main thread
// through bun:ffi, with no bun:objc import at all; "thread", one raised
// through bun:objc on a detached NSThread; "string", a plain NSString thrown
// with objc_exception_throw through bun:ffi (not an NSException, so it has
// no -name or -reason).
import { dlopen } from "bun:ffi";
import { run } from "./_util";

const how = process.argv[2] ?? "main";

await run(async () => {
  if (how === "thread") {
    const { objc } = await import("bun:objc");
    const { NSException, NSThread } = objc.classes;
    const exception = NSException.exceptionWithName_reason_userInfo_("BunTestException", "raised on purpose", null);
    using hold = objc.app.retain();
    NSThread.detachNewThreadSelector_toTarget_withObject_("raise", exception, null);
    await new Promise(resolve => setTimeout(resolve, 2_000));
    console.log("not reached");
    return;
  }
  const { app } = await import("bun:appkit");
  app.keepAlive = true;
  const objc = dlopen("/usr/lib/libobjc.A.dylib", {
    objc_getClass: { args: ["cstring"], returns: "ptr" },
    sel_registerName: { args: ["cstring"], returns: "ptr" },
    objc_msgSend: { args: ["ptr", "ptr", "ptr", "ptr", "ptr"], returns: "ptr" },
    objc_exception_throw: { args: ["ptr"], returns: "void" },
  });
  const cf = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", {
    CFStringCreateWithCString: { args: ["ptr", "cstring", "u32"], returns: "ptr" },
  });
  const c = (s: string) => Buffer.from(s + "\0");
  const sel = (s: string) => objc.symbols.sel_registerName(c(s));
  const utf8 = 0x08000100;
  const NSException = objc.symbols.objc_getClass(c("NSException"));
  const name = cf.symbols.CFStringCreateWithCString(null, c("BunTestException"), utf8);
  const reason = cf.symbols.CFStringCreateWithCString(null, c("raised on purpose"), utf8);
  setTimeout(() => {
    if (how === "string") {
      objc.symbols.objc_exception_throw(cf.symbols.CFStringCreateWithCString(null, c("a thrown string"), utf8));
    } else {
      const exception = objc.symbols.objc_msgSend(
        NSException,
        sel("exceptionWithName:reason:userInfo:"),
        name,
        reason,
        null,
      );
      objc.symbols.objc_msgSend(exception, sel("raise"), null, null, null);
    }
    console.log("not reached");
  }, 10);
});

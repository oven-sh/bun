// Raises an NSException on the main thread with nothing to catch it. Nothing in
// bun:appkit does this on purpose; the point is that the crash names the
// exception and its reason instead of only "a C++ exception".
import { dlopen } from "bun:ffi";
import { app } from "bun:appkit";
import { run } from "./_util";

await run(() => {
  app.keepAlive = true;
  const objc = dlopen("/usr/lib/libobjc.A.dylib", {
    objc_getClass: { args: ["cstring"], returns: "ptr" },
    sel_registerName: { args: ["cstring"], returns: "ptr" },
    objc_msgSend: { args: ["ptr", "ptr", "ptr", "ptr", "ptr"], returns: "ptr" },
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
    const exception = objc.symbols.objc_msgSend(
      NSException,
      sel("exceptionWithName:reason:userInfo:"),
      name,
      reason,
      null,
    );
    objc.symbols.objc_msgSend(exception, sel("raise"), null, null, null);
    console.log("not reached");
  }, 10);
});

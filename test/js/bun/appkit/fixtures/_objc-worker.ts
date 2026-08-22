import { objc } from "bun:appkit";

function attempt(f: () => unknown) {
  try {
    f();
    return { threw: false };
  } catch (e) {
    const err = e as Error & { code?: string };
    return { threw: true, code: err?.code ?? null, message: String(err?.message) };
  }
}

postMessage({
  lookup: attempt(() => objc.classes.NSString),
  ns: attempt(() => objc.ns(1)),
  // Pure JavaScript, so allowed anywhere.
  sel: attempt(() => String(objc.sel("length"))),
});

// The collector is told what an NSData, NSString or NSBitmapImageRep handle
// weighs (and told again when a mutable one grows through its handle), so a
// loop that makes large ones and drops them is collected as it goes and
// resident memory stays far below what was allocated in total.
import { heapStats } from "bun:jsc";
import { objc } from "bun:objc";
import { emit, run } from "./_util";

await run(async () => {
  const { NSMutableData, NSString, NSBitmapImageRep } = objc.classes;
  NSMutableData.data();
  const MB = 1 << 20;
  // What the collector was told, read back after a full collection (which
  // recounts it from the live handles).
  const extra = () => (Bun.gc(true), heapStats().extraMemorySize);
  {
    const before = extra();
    const data = NSMutableData.dataWithLength_(16 * MB);
    const withData = extra() - before;
    const text = NSString.stringWithString_("x".repeat(MB));
    const withText = extra() - before;
    const rep =
      NSBitmapImageRep.alloc().initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel_(
        null,
        1024,
        1024,
        8,
        4,
        true,
        false,
        "NSDeviceRGBColorSpace",
        0,
        0,
      );
    const withRep = extra() - before;
    // Grown after the handle was made, through the handle.
    const grown = NSMutableData.dataWithCapacity_(0);
    const beforeGrowth = extra();
    grown.setLength_(8 * MB);
    const growth = extra() - beforeGrowth;
    emit({
      step: "weighed",
      dataMB: Math.round(withData / MB),
      textMB: Math.round((withText - withData) / MB),
      repMB: Math.round((withRep - withText) / MB),
      growthMB: Math.round(growth / MB),
      alive: [data.length(), text.length(), rep.pixelsWide(), grown.length()].length,
    });
  }

  const total = 1024;
  Bun.gc(true);
  const base = process.memoryUsage().rss;
  let peak = 0;
  for (let i = 0; i < total; i++) {
    const data = NSMutableData.dataWithLength_(MB);
    // The pages are zero-fill until touched.
    data.resetBytesInRange_({ location: 0, length: MB });
    if (i % 64 === 63) peak = Math.max(peak, process.memoryUsage().rss - base);
  }
  emit({ step: "pressure", allocatedMB: total, peakMB: Math.round(peak / MB) });

  // A retained handle is its native wrapper and its proxy, and nothing per
  // handle until a method is read: the traps and the functions behind the
  // symbols every handle answers are shared.
  {
    const { NSNumber } = objc.classes;
    const count = 20_000;
    const objects = () => (Bun.gc(true), heapStats().objectCount);
    const held: unknown[] = [];
    const before = objects();
    for (let i = 0; i < count; i++) held.push(NSNumber.numberWithInt_(i));
    const perHandle = (objects() - before) / count;
    const sample = held[7] as any;
    const other = held[8] as any;
    emit({
      step: "handle cost",
      perHandle: Math.round(perHandle * 10) / 10,
      sameMethodTwice: sample.intValue === sample.intValue,
      ownMethods: sample.intValue !== other.intValue,
      sharedToPrimitive: sample[Symbol.toPrimitive] === other[Symbol.toPrimitive] && `${sample}` === "7",
      sharedInspect:
        sample[Symbol.for("nodejs.util.inspect.custom")] === NSNumber[Symbol.for("nodejs.util.inspect.custom")],
      held: held.length,
    });
  }
});

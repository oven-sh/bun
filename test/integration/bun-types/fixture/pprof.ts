import { expectType } from "./utilities";

Bun.pprof.heap.start();
Bun.pprof.heap.start({});
Bun.pprof.heap.start({ sampleInterval: 1024 * 1024 });
Bun.pprof.heap.start({ sampleInterval: undefined });
// @ts-expect-error
Bun.pprof.heap.start({ sampleInterval: "512kb" });

expectType(Bun.pprof.heap.profile()).is<Uint8Array<ArrayBuffer>>();
expectType(Bun.pprof.heap.stop()).is<Uint8Array<ArrayBuffer>>();
expectType(Bun.pprof.heap.isRunning).is<boolean>();

new Response(Bun.pprof.heap.profile());
await Bun.write("heap.pb.gz", Bun.pprof.heap.stop());

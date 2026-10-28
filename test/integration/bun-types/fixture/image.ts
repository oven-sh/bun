import * as tsd from "./utilities";

{
  const img = new Bun.Image(new Uint8Array(0));
  tsd.expectType<Bun.Image>(img.jpeg({ quality: 82, chromaSubsampling: "4:4:4" }));
  tsd.expectType<Bun.Image>(img.jpeg({ chromaSubsampling: "4:2:0" }));
  // @ts-expect-error only "4:2:0" and "4:4:4" are valid
  img.jpeg({ chromaSubsampling: "4:2:2" });
}

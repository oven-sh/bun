import { expectType } from "./utilities";

const img = new Bun.Image(new Uint8Array(0)).resize(224, 224, { fit: "fill" });

const px = await img.pixels();
expectType(px).is<Bun.Image.Pixels>();
expectType(px.data).is<Uint8Array>();
expectType(px.width).is<number>();
expectType(px.height).is<number>();
expectType(px.channels).is<4>();

// A terminal, not a pipeline slot: it does not return the image.
// @ts-expect-error
img.pixels().png();

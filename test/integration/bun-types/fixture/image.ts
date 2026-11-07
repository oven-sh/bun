const img = new Bun.Image(new Uint8Array(0));

img.resize(800);
img.resize(800, 600);
img.resize(800, 600, { fit: "inside" });
img.resize(null, 600);
img.resize(undefined, 600);
img.resize(null, 600, { fit: "inside", withoutEnlargement: true });

// A nullish width needs a height.
// @ts-expect-error
img.resize();
// @ts-expect-error
img.resize(null);
// @ts-expect-error
img.resize(undefined);
// @ts-expect-error
img.resize(null, undefined);
// @ts-expect-error
img.resize("800", 600);
// @ts-expect-error
img.resize(null, "600");

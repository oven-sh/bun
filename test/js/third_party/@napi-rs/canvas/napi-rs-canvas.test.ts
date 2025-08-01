// Create an image, then print it as binary to stdout
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { Jimp } from "jimp";
import { join } from "path";

describe("@napi-rs/canvas", () => {
  it("produces correct output", async () => {
    const canvas = createCanvas(200, 200);
    const ctx = canvas.getContext("2d");

    ctx.lineWidth = 10;
    ctx.strokeStyle = "red";
    ctx.fillStyle = "blue";

    ctx.fillRect(0, 0, 200, 200);
    ctx.strokeRect(50, 50, 100, 100);

    const image = await loadImage(join(__dirname, "icon-small.png"));
    ctx.drawImage(image, 0, 0);

    const expected = await Jimp.read(join(__dirname, "expected.png"));
    const actual = await Jimp.read(await canvas.encode("png"));
    expect(Array.from(actual.bitmap.data)).toEqual(Array.from(expected.bitmap.data));
  });
});

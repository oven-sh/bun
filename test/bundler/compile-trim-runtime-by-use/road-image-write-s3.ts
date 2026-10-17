const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
try {
  await new Bun.Image(png).write("s3://bucket/key.png");
  console.log("written");
} catch (error) {
  console.log("threw", (error as Error).name, (error as any).code);
}

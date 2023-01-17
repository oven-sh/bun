import { transform, transformSync } from "esbuild";

{
  const result = await transform("console.log('hello world')", {
    loader: "js",
    target: "node12",
  });
  if (result.code !== 'console.log("hello world");\n') {
    throw new Error("Test failed.");
  }
}

{
  const hugeString = `console.log(${JSON.stringify("a".repeat(1000000))});`;

  for (let i = 0; i < 2; i++) {
    const result = await transform(hugeString, {
      loader: "js",
      target: "node12",
    });
    if (result.code !== hugeString + "\n") {
      throw new Error("Test failed.");
    }
  }
}

{
  const result = transformSync("console.log('hello world')", {
    loader: "js",
    target: "node12",
  });
  if (result.code !== 'console.log("hello world");\n') {
    throw new Error("Test failed.");
  }
}

process.exit(0);

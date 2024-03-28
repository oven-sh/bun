import { build, buildSync, transform, transformSync } from "esbuild";

{
  console.log(1);
  const result = await transform("console.log('hello world')", {
    loader: "js",
    target: "node12",
  });
  if (result.code !== 'console.log("hello world");\n') {
    throw new Error("Test failed.");
  }
}

{
  console.log(2);
  const hugeString = `console.log("${"a".repeat(1000000)}");`;

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
  console.log(3);
  const result = transformSync("console.log('hello world')", {
    loader: "js",
    target: "node12",
  });
  if (result.code !== 'console.log("hello world");\n') {
    throw new Error("Test failed.");
  }
}

{
  console.log(4);
  const result = await build({
    stdin: {
      "contents": "console.log('hello world')",
      "loader": "js",
      "sourcefile": "index.js",
    },
    write: false,
    target: "node12",
  });
  if (result.outputFiles[0].text !== 'console.log("hello world");\n') {
    throw new Error("Test failed.");
  }
}

{
  const contents = `console.log("${"a".repeat(1000000)}");`;

  for (let i = 0; i < 2; i++) {
    console.log(5);
    const result = await build({
      target: "node12",
      write: false,
      stdin: {
        contents,
        "loader": "js",
        "sourcefile": "index.js",
      },
    });
    if (result.outputFiles[0].text !== contents + "\n") {
      throw new Error("Test failed.");
    }
  }
}

{
  console.log(6);
  const result = await build({
    stdin: {
      "contents": "console.log('hello world')",
      "loader": "js",
      "sourcefile": "index.js",
    },
    write: false,
    target: "node12",
  });
  if (result.outputFiles[0].text !== 'console.log("hello world");\n') {
    throw new Error("Test failed.");
  }
}

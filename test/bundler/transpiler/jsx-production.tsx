import { renderToReadableStream } from "react-dom/server.browser";

const HelloWorld = () => {
  return <div>Hello World</div>;
};

const stream = new Response(await renderToReadableStream(<HelloWorld />));

console.log(await stream.text());

if (!process.env.NO_BUILD) {
  const self = await Bun.build({
    entrypoints: [import.meta.path],
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.CHILD_NODE_ENV),
      "process.env.NO_BUILD": "1",
    },
  });
  const code = await self.outputs[0].text();
  // The tsconfig.json beside this file says "jsx": "react-jsx". Of the `define` values above, only "development"
  // selects jsxDEV.
  let shouldHaveJSXDev = process.env.CHILD_NODE_ENV === "development";
  let shouldHaveJSX = !shouldHaveJSXDev;

  if (shouldHaveJSXDev) {
    if (!code.includes("jsx_dev_runtime.jsxDEV")) {
      throw new Error("jsxDEV is not included");
    }
  }

  if (shouldHaveJSX) {
    if (!code.includes("jsx_runtime.jsx")) {
      throw new Error("Jsx is not included");
    }
  }

  const url = URL.createObjectURL(self.outputs[0]);
  await import(url);
}

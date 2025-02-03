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

  const url = URL.createObjectURL(self.outputs[0]);
  await import(url);
}

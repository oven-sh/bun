const html = Bun.markdown.htmlStream();
console.log(JSON.stringify([html.write("# Title\n\n*a*"), html.preview(), html.end(" &amp; b")]));

const { readable, writable } = Bun.markdown.renderStream({ paragraph: (children: string) => `(${children})` });
const writer = writable.getWriter();
writer.write("a\n\nb");
writer.close();
for await (const part of readable) console.log(part);

console.log(JSON.stringify([Bun.markdown.tokens("- *a*"), Bun.markdown.tokensStream().end("|a|\n|-|")]));

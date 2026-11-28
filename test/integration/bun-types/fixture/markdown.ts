import { expectType } from "./utilities";

const html = Bun.markdown.htmlStream({ headings: true });
expectType(html).is<Bun.markdown.MarkdownStream<string>>();
expectType(html.write("a")).is<string>();
expectType(html.write(new Uint8Array())).is<string>();
expectType(html.preview()).is<string>();
expectType(html.end()).is<string>();
expectType(html.end("a")).is<string>();
// @ts-expect-error
html.write();
// @ts-expect-error
html.write(1);

expectType(Bun.markdown.ansiStream({ columns: 60 }).end()).is<string>();
expectType(Bun.markdown.renderStream({ paragraph: children => children }, { tables: false }).end()).is<string>();
expectType(Bun.markdown.reactStream(undefined, { reactVersion: 18 }).end()).is<
  ReturnType<typeof Bun.markdown.react>[]
>();

expectType(Bun.markdown.tokensStream({ maxNesting: 10 }).end()).is<Bun.markdown.Token[]>();
for (const token of Bun.markdown.tokens("a", { noReferenceDefinitions: true })) {
  if (token.type === "list") expectType(token.items[0]!.checked).is<boolean | undefined>();
  if (token.type === "html" && token.block) expectType(token.pre).is<boolean>();
}

new Response(Bun.file("README.md").stream().pipeThrough(Bun.markdown.htmlStream()));
for await (const text of Bun.stdin.stream().pipeThrough(Bun.markdown.ansiStream())) {
  expectType(text).is<string>();
}
for await (const text of new ReadableStream<string>().pipeThrough(Bun.markdown.htmlStream())) {
  expectType(text).is<string>();
}

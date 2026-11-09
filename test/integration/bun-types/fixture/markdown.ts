import { expectType } from "./utilities";

const { data, content } = Bun.markdown.frontmatter("---\ntitle: Hello\n---\n# Heading\n");
expectType(data).is<Record<string, unknown> | null>();
expectType(content).is<string>();
expectType(Bun.markdown.frontmatter(new Uint8Array(1))).is<Bun.markdown.FrontmatterResult>();
Bun.markdown.frontmatter(Buffer.from("# Heading\n"));
Bun.markdown.frontmatter(new ArrayBuffer(1));
Bun.markdown.frontmatter(new DataView(new ArrayBuffer(1)));
// @ts-expect-error
Bun.markdown.frontmatter(1);
// @ts-expect-error
Bun.markdown.frontmatter();

expectType(Bun.markdown.html(content, { frontmatter: false })).is<string>();
expectType(Bun.markdown.render(content, {}, { frontmatter: false })).is<string>();
expectType(Bun.markdown.ansi(content, { frontmatter: false })).is<string>();
Bun.markdown.react(content, undefined, { frontmatter: false });
// @ts-expect-error
Bun.markdown.html(content, { frontmatter: "yaml" });

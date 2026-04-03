// https://github.com/oven-sh/bun/issues/28810
import { expect, test } from "bun:test";

test("wikilink preserves preceding text order", () => {
  const html = Bun.markdown.html("Hello [[world]], this is a test.", { wikiLinks: true });
  expect(html).toBe('<p>Hello <x-wikilink data-target="world">world</x-wikilink>, this is a test.</p>\n');
});

test("wikilink preserves preceding text order with label", () => {
  const html = Bun.markdown.html("before [[target|label]] after", { wikiLinks: true });
  expect(html).toBe('<p>before <x-wikilink data-target="target">label</x-wikilink> after</p>\n');
});

test("wikilink with text on both sides and emphasis", () => {
  const html = Bun.markdown.html("*prefix* [[foo]] *suffix*", { wikiLinks: true });
  expect(html).toBe('<p><em>prefix</em> <x-wikilink data-target="foo">foo</x-wikilink> <em>suffix</em></p>\n');
});

test("multiple wikilinks with interleaved text", () => {
  const html = Bun.markdown.html("a [[x]] b [[y]] c", { wikiLinks: true });
  expect(html).toBe(
    '<p>a <x-wikilink data-target="x">x</x-wikilink> b <x-wikilink data-target="y">y</x-wikilink> c</p>\n',
  );
});

test("wikilink parse failure falls back to regular link without duplicating text", () => {
  const html = Bun.markdown.html("pre [[foo]\n\n[foo]: /url", { wikiLinks: true });
  expect(html).toBe('<p>pre [<a href="/url">foo</a></p>\n');
});

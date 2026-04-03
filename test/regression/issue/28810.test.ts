// https://github.com/oven-sh/bun/issues/28810
import { expect, test } from "bun:test";

test("wikilink preserves preceding text and interleaved content", () => {
  expect(Bun.markdown.html("Hello [[world]], this is a test.", { wikiLinks: true })).toBe(
    '<p>Hello <x-wikilink data-target="world">world</x-wikilink>, this is a test.</p>\n',
  );
  expect(Bun.markdown.html("before [[target|label]] after", { wikiLinks: true })).toBe(
    '<p>before <x-wikilink data-target="target">label</x-wikilink> after</p>\n',
  );
  expect(Bun.markdown.html("*prefix* [[foo]] *suffix*", { wikiLinks: true })).toBe(
    '<p><em>prefix</em> <x-wikilink data-target="foo">foo</x-wikilink> <em>suffix</em></p>\n',
  );
  expect(Bun.markdown.html("a [[x]] b [[y]] c", { wikiLinks: true })).toBe(
    '<p>a <x-wikilink data-target="x">x</x-wikilink> b <x-wikilink data-target="y">y</x-wikilink> c</p>\n',
  );
  expect(Bun.markdown.html("pre [[foo]\n\n[foo]: /url", { wikiLinks: true })).toBe(
    '<p>pre [<a href="/url">foo</a></p>\n',
  );
});

// https://github.com/oven-sh/bun/issues/28810
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function renderMarkdown(input: string): Promise<string> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `process.stdout.write(Bun.markdown.html(${JSON.stringify(input)}, { wikiLinks: true }))`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(exitCode).toBe(0);
  return stdout;
}

test("wikilink preserves preceding text order", async () => {
  expect(await renderMarkdown("Hello [[world]], this is a test.")).toBe(
    '<p>Hello <x-wikilink data-target="world">world</x-wikilink>, this is a test.</p>\n',
  );
});

test("wikilink preserves preceding text order with label", async () => {
  expect(await renderMarkdown("before [[target|label]] after")).toBe(
    '<p>before <x-wikilink data-target="target">label</x-wikilink> after</p>\n',
  );
});

test("wikilink with text on both sides and emphasis", async () => {
  expect(await renderMarkdown("*prefix* [[foo]] *suffix*")).toBe(
    '<p><em>prefix</em> <x-wikilink data-target="foo">foo</x-wikilink> <em>suffix</em></p>\n',
  );
});

test("multiple wikilinks with interleaved text", async () => {
  expect(await renderMarkdown("a [[x]] b [[y]] c")).toBe(
    '<p>a <x-wikilink data-target="x">x</x-wikilink> b <x-wikilink data-target="y">y</x-wikilink> c</p>\n',
  );
});

test("wikilink parse failure falls back to regular link without duplicating text", async () => {
  expect(await renderMarkdown("pre [[foo]\n\n[foo]: /url")).toBe('<p>pre [<a href="/url">foo</a></p>\n');
});

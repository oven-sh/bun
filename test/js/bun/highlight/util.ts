import { Glob } from "bun";
import { expect } from "bun:test";
import { join } from "node:path";

export const fixturesDir = join(import.meta.dir, "fixtures");
export const fixtures = [...new Glob("*").scanSync(fixturesDir)].sort();

export function languageOf(file: string): string {
  return file.endsWith(".component.html") ? "angular" : file.slice(file.lastIndexOf(".") + 1);
}

export const unescape = (html: string) => html.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
export const stripTags = (html: string) => unescape(html.replace(/<\/?span[^>]*>/g, ""));
export const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

/** `hl-keyword hl-keyword-control` is `keyword.control`. */
const nameOf = (classes: string) => classes.split(" ").at(-1)!.slice("hl-".length).replaceAll("-", ".");

/** `[["const", "keyword"], ["a", "variable"], ...]` */
export function tokens(code: string, language: string): [string, string][] {
  const html = Bun.highlight.html(code, language);
  if (html === null) throw new Error(`${language} is not highlighted`);
  return [...html.matchAll(/<span class="([^"]+)">([^<]*)<\/span>/g)].map(([, classes, text]) => [
    unescape(text),
    nameOf(classes),
  ]);
}

/** What `text` is, each time it occurs. */
export function tokensOf(code: string, language: string, text: string): string[] {
  return tokens(code, language)
    .filter(token => token[0] === text)
    .map(token => token[1]);
}

/** The code with each token as `⟦name|text⟧`. */
export function annotate(code: string, language: string): string {
  return unescape(
    Bun.highlight
      .html(code, language)!
      .replace(/<span class="([^"]+)">([^<]*)<\/span>/g, (_, classes, text) => `⟦${nameOf(classes)}|${text}⟧`),
  );
}

export const { Theme } = Bun.highlight;
export const trueColor = new Theme("dark", { colorDepth: 24 });

/** Whatever the input is, the output is the input plus markup. */
export function expectIntact(code: string, language: string) {
  const html = Bun.highlight.html(code, language)!;
  expect(stripTags(html)).toBe(code);
  for (const line of html.split("\n")) {
    expect(line.split("<span ").length).toBe(line.split("</span>").length);
  }
  const ansi = trueColor.ansi(code, language)!;
  expect(stripAnsi(ansi)).toBe(code);
}

import { expectType } from "./utilities";

declare const anyLanguage: string;

// A language that Bun knows always gives a string.
expectType(Bun.highlight.html("let a", "ts")).is<string>();
// Any other string may not be a language.
expectType(Bun.highlight.html("let a", anyLanguage)).is<string | null>();

expectType(Bun.highlight.html(new Uint8Array(), "css")).is<string>();
expectType(Bun.highlight.html(new ArrayBuffer(0), "css")).is<string>();
expectType(Bun.highlight.html(Buffer.from(""), "css")).is<string>();

const styles: Bun.highlight.ThemeStyles = {
  foreground: "#fff",
  background: "#000",
  keyword: "red",
  "keyword.control": { color: "blue", bold: true, italic: false, underline: true, strikethrough: false },
  comment: undefined,
};
const theme = new Bun.highlight.Theme(styles, { colorDepth: 24 });
expectType(theme).is<Bun.highlight.Theme>();
expectType(theme.ansi("let a", "ts")).is<string>();
expectType(theme.ansi("let a", anyLanguage)).is<string | null>();
expectType(theme.ansi(new Uint8Array(), "css")).is<string>();
expectType(theme.css()).is<string>();

new Bun.highlight.Theme();
new Bun.highlight.Theme("dark");
new Bun.highlight.Theme("light", { colorDepth: 1 });
new Bun.highlight.Theme(undefined, {});

// @ts-expect-error
Bun.highlight.html("a");
// @ts-expect-error
theme.ansi("a");
// @ts-expect-error
new Bun.highlight.Theme("dark", { colorDepth: 2 });
// @ts-expect-error
new Bun.highlight.Theme("solarized");
// @ts-expect-error
new Bun.highlight.Theme({ keywrd: "red" });

const token: Bun.highlight.Token = "markup.link.url";
const language: Bun.highlight.Language = "svelte";
token satisfies string;
language satisfies string;

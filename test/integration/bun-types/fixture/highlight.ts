import { expectType } from "./utilities";

declare const anyLanguage: string;

// A language that Bun knows always gives a string.
expectType(Bun.highlight.html("let a", "ts")).is<string>();
expectType(Bun.highlight.ansi("let a", "ts")).is<string>();
expectType(Bun.highlight.ansi("let a", { language: "ts" })).is<string>();

// Any other string may not be a language.
expectType(Bun.highlight.html("let a", anyLanguage)).is<string | null>();
expectType(Bun.highlight.ansi("let a", anyLanguage)).is<string | null>();
expectType(Bun.highlight.ansi("let a", { language: anyLanguage })).is<string | null>();

expectType(Bun.highlight.html(new Uint8Array(), "css")).is<string>();
expectType(Bun.highlight.html(new ArrayBuffer(0), "css")).is<string>();
expectType(Bun.highlight.html(Buffer.from(""), "css")).is<string>();

const theme: Bun.highlight.Theme = {
  foreground: "#fff",
  background: "#000",
  keyword: "red",
  "keyword.control": { color: "blue", bold: true, italic: false, underline: true, strikethrough: false },
  comment: undefined,
};
expectType(Bun.highlight.ansi("a", { language: "js", theme, colorDepth: 24 })).is<string>();
expectType(Bun.highlight.ansi("a", { language: "js", theme: "dark", colorDepth: 1 })).is<string>();
expectType(Bun.highlight.css()).is<string>();
expectType(Bun.highlight.css("light")).is<string>();
expectType(Bun.highlight.css(theme)).is<string>();

// @ts-expect-error
Bun.highlight.html("a");
// @ts-expect-error
Bun.highlight.ansi("a", { theme: "dark" });
// @ts-expect-error
Bun.highlight.ansi("a", { language: "js", colorDepth: 2 });
// @ts-expect-error
Bun.highlight.ansi("a", { language: "js", theme: "solarized" });
// @ts-expect-error
Bun.highlight.css({ keywrd: "red" });

const token: Bun.highlight.Token = "markup.link.url";
const language: Bun.highlight.Language = "svelte";
token satisfies string;
language satisfies string;

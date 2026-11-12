console.log(
  "Ünï cödé 42 λόγος".match(/\p{L}+/gu)?.join("|"),
  /^\p{Script=Greek}+$/u.test("λόγος"),
  /\P{Lu}/u.test("A"),
  "a1٣".replace(/\p{Nd}/gu, "#"),
);
console.log(
  new RegExp("\\p{Emoji_Presentation}", "u").test("🙂"),
  /[\p{Lu}--[A-C]]/v.test("D"),
  /[\p{Lu}--[A-C]]/v.test("B"),
);
try {
  new RegExp("\\p{Nope}", "u");
} catch (error) {
  console.log((error as Error).name);
}

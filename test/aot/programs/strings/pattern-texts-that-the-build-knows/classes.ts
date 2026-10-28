export const INVISIBLE_CLASS = String.raw`­͏؜​-‏⁠-⁯`;
export const MARK_CLASS = String.raw`؀-؅۝`;
export const INVISIBLE_RUN = `[${INVISIBLE_CLASS}${MARK_CLASS}\\ufeff]*`;
export const INVISIBLE_CHARACTER = new RegExp(`[${INVISIBLE_CLASS}${MARK_CLASS}\\ufeff]`);

export function spread(words: string): string {
  return words
    .replace(/([a-z)])(?=[a-z(\[])/gi, `$1${INVISIBLE_RUN}`)
    .replace(/\[_-\]\?/g, `(?:[_-]${INVISIBLE_RUN})?`);
}
export function escapeText(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export const MOST = 8;

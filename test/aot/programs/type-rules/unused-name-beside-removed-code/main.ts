// A name that is unused in the source is still reported when the build removes code beside it.
const WINDOWS_PATH = /^[a-zA-Z]:/;
const neverRead = 1;
function isAbsolute(path: string): boolean {
  if (process.platform === "win32") return WINDOWS_PATH.test(path);
  return path.startsWith("/");
}
console.log(isAbsolute("/a"));

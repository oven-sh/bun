// Files that tests import for their path (the "file" loader) or their text (`with { type: "text" }`).
// TypeScript 7.1 can declare these by import attribute instead of by extension, see packages/bun-types/ts7.1.
declare module "*.c" {
  var contents: string;
  export = contents;
}
declare module "*.cc" {
  var contents: string;
  export = contents;
}
declare module "*.h" {
  var contents: string;
  export = contents;
}
declare module "*.pem" {
  var contents: string;
  export = contents;
}
declare module "*.br" {
  var contents: string;
  export = contents;
}
declare module "*.gzip" {
  var contents: string;
  export = contents;
}

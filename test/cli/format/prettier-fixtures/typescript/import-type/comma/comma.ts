type A = import("foo", {
  with: {
  type: "json",}})
type A = import("foo", {
  with: {
  type: "json"},})
// Not supported, https://github.com/microsoft/TypeScript/issues/61489
// type A = import("foo", {
//   with: {
//   type: "json"}},)

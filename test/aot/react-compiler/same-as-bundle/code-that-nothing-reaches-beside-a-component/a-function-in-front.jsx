function neverCalled() {
  return 1;
}
// A CommonJS file: the `require` that the output needs stands at the head of the body, where the first statement begins.
function useRequired(a) {
  "use memo";
  return [a, "required"];
}
module.exports = { useRequired };

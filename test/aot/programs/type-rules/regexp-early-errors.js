// Regular expression literals that JavaScript rejects stop the build of a JavaScript file too, also in a function that is never called.
function unused() {
  return [
    /\1/u,
    /a**/,
    /(?<a>.)\k<b>/,
    /[b-a]/,
  ];
}
console.log(typeof unused);

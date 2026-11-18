var scope = { suffix: "!" };
var seen;
with (scope) {
  seen = suffix;
}
var gone = 1;
var deleted = delete gone;

function useWords(title) {
  "use memo";
  return [title, seen, deleted];
}

module.exports = { useWords };

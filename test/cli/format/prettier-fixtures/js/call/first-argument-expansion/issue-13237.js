/* version 1 */

exportDefaultWhatever(function (
  aaaaaaaaaaaString,
  bbbbbbbbbbbString,
  cccccccccccString,
) {
  return null;
}, "xyz");

/* version 2 (only difference is that `//`) */

exportDefaultWhatever(function (
  aaaaaaaaaaaString,  //
  bbbbbbbbbbbString,
  cccccccccccString,
) {
  return null;
}, "xyz");

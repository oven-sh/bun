const w = a.b(
  (
    c = "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdef",
    d = "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdef"
  ) =>
  (e) =>
    0
);

const x = a.b(
  (
    c = "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdef",
    d = "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdef"
  ) =>
  (e) =>
    0
)(x);

const y = a.b(
  1,
  (
    c = "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdef",
    d = "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdef"
  ) =>
  (e) =>
    0
)(x);

const z = a.b(
  (
    c = "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdef",
    d = "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdef"
  ) =>
  (e) =>
    0,
  2
)(x);


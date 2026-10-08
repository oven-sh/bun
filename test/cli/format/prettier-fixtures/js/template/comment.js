`
(?:${escapeChar}[\\S\\s]|(?:(?!${// Using `XRegExp.union` safely rewrites backreferences in `left` and `right`.
// Intentionally not passing `basicFlags` to `XRegExp.union` since any syntax
// transformation resulting from those flags was already applied to `left` and
// `right` when they were passed through the XRegExp constructor above.
XRegExp.union([left, right], '', {conjunction: 'or'}).source})[^${escapeChar}])+)+
`;

`a${/* b */c/* d */}e${// f
g
// h
}`;

group(
  concat([
    "(",
    indent(
      options.tabWidth,
      concat([line, join(concat([",", line]), printed)])
    ),
    options.trailingComma ? "," : "",
    line,
    ")"
  ]),
  {shouldBreak: true}
)

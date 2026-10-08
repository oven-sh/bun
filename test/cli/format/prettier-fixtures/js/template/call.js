insertRule(`*, *:before, *:after {
  box-sizing: inherit;
}`);

insertRule`*, *:before, *:after {
  box-sizing: inherit;
}`;

new Error(formatErrorMessage`
  This a really bad error.
  Which has more than one line.
`);

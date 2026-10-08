md`
This line shouldn't be indented at all in the resulting output.
`

if (true) {
  md`
text1
- 123
  - 456

text2
- 123
  - 456

text3
- 123
  - 456
`;
}

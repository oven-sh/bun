gql`
  "\`foo\` mutation payload."
  type      FooPayload       {
    	bar: String
  }
`

gql`
type Project {
    "Pattern: \`\${project}\`"
    pattern: String
    """
    Pattern: \`\${project}\`
    """
    pattern: String

	# Also: Escaping the first parentheses...
	"Pattern: \`$\{project}\`"
    pattern: String
    # Or escaping the first and second parentheses...
	"Pattern: \`$\{project\}\`"
    pattern: String
}
`

gql`
  """
  - \`
  - \\\`
  - \\ a
  - \\\\
  - $
  - \$
  - \${
  - \\\${
  - \u1234
  """
  type A {
    a
  }
`

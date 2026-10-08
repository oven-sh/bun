graphql(schema, `
query allPartsByManufacturerName($name: String!) {
  allParts(filter:{manufacturer: {name: $name}}) {
...    PartAll
}}
${fragments.all}
`)

const veryLongVariableNameToMakeTheLineBreak = graphql(schema, `
query allPartsByManufacturerName($name: String!) {
  allParts(filter:{manufacturer: {name: $name}}) {
...    PartAll
}}
${fragments.all}
`)

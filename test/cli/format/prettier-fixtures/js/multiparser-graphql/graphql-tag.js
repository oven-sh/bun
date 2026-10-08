import gql from "graphql-tag";

const query = gql`
      {
    user(   id :   5  )  {
      firstName

      lastName
    }
  }
`;


// With interpolations:

gql`
query User {
  user(id:5){
    ...UserDetails
    ...Friends
  }
}

${USER_DETAILS_FRAGMENT}${FRIENDS_FRAGMENT}
`


// Skip if non-toplevel interpolation:

gql`
query User {
  user(id:${id}){ name }
}
`


// Skip if top-level interpolation within comment:

gql`
query User {
  user(id:5){ name }
}
#${test}
`


// Comment on last line:

gql`
query User {
  user(id:5){ name }
}
# comment`
// ` <-- editor syntax highlighting workaround


// Preserve up to one blank line between things and enforce linebreak between
// interpolations:

gql`
# comment
${one}${two}  ${three}
${four}

${five}
# comment
${six}

# comment
${seven}
# comment

${eight}

  # comment with trailing whitespace      


# blank line above this comment


`


// Interpolation directly before and after query:

gql`${one} query Test { test }${two}`


// Only interpolation:

gql`${test}`


// Only comment:

gql`# comment`
// ` <-- editor syntax highlighting workaround


// Only whitespace:

gql`   `


// Empty:

gql``


// Comments after other things:
// Currently, comments after interpolations are moved to the next line.
// We might want to keep them on the next line in the future.

gql`
  ${test} # comment

  query Test { # comment
    test # comment
  } # comment
  ${test} # comment
  ${test} # comment

  ${test} # comment

  # comment
  ${test} # comment
`


// Larger mixed test:

gql`



query User {
  test
}

    
	
${USER_DETAILS_FRAGMENT}

   # Comment    
   # that continues on a new line

    
   # and has a blank line in the middle

    ${FRIENDS_FRAGMENT}
  ${generateFragment({
     totally:  "a good idea"
    })}

${fragment}#comment

fragment another on User { name
}${ fragment }`

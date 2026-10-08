const Header = styled.div`
  ${something()}
  & > ${Child}:not(:first-child) {
margin-left:5px;
}
`

const Header2 = styled.div`
  ${something()}
  & > ${Child}${Child2}:not(:first-child) {
margin-left:5px;
}
`

styled.div`${foo}-idle { }`

styled.div`${foo}-0-idle { }`

styled.div`
font-family: "${a}", "${b}";
`

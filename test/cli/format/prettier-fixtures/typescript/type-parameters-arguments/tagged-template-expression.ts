export const RedBox = styled.div<{foo: string}>`
  background: red;
  ${props => props.foo}
`;

const StyledComponent = styled.div`
  margin-right: -4px;

  ${Container}.isExpanded & {
    transform: rotate(-180deg);
  }
`;

const StyledComponent2 = styled.div`
  margin-right: -4px;

  ${abc}.camelCase + ${def}.camelCase & {
    transform: rotate(-180deg);
  }
`;

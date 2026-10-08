const Icon = styled.div`
  height: 48px;

  ${Link}:nth-child(2) {
    fill: rebeccapurple;
  }
`;

const Icon2 = styled.div`
  height: 48px;

  ${Link}:empty:before{
    fill: rebeccapurple;
  }
`;

const Icon3 = styled.div`
  height: 48px;

  ${Link}:not(:first-child) {
    fill: rebeccapurple;
  }
`;

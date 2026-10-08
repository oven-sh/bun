const Icon = styled.div`
  flex: none;
  transition:    fill 0.25s;
  width: 48px;
  height: 48px;

  ${Link}:hover {
    fill:   rebeccapurple;
  }

  ${Link} :hover {
    fill: yellow;
  }

  ${media.smallDown}::before {}
`

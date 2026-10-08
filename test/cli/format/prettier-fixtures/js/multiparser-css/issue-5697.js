const StyledH1 = styled.div`
  font-size: 2.5em;
  font-weight: ${(props) => (props.strong ? 500 : 100)};
  font-family: ${constants.text.displayFont.fontFamily};
  letter-spacing: ${(props) => (props.light ? '0.04em' : 0)};
  color: ${(props) => props.textColor};
  ${(props) =>
    props.center
      ? ` display: flex;
                align-items: center;
                justify-content: center;
                text-align: center;`
      : ''}
  @media (max-width: ${(props) => (props.noBreakPoint ? '0' : constants.layout.breakpoint.break1)}px) {
    font-size: 2em;
  }
`;

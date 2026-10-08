const Steps = styled.div`
  @media (min-width: 1px) {
    ${Step}:nth-child(odd) {}
  }
`;

const Steps2 = styled.div`
  @media (min-width: ${breakpoints.lg}) {
    ${Step} {
      margin-bottom: 90px;
    }

    ${Step}:nth-child(odd) {
      ${StepItemDescription} {
        grid-row: 1;
        grid-column: 3 / span 3;
      }
      ${Image} {
        grid-row: 1;
        grid-column: 7 / span 6;
      }
    }

    ${Step}:nth-child(even) {
      ${Image} {
        grid-row: 1;
        grid-column: 3 / span 6;
      }
      ${StepItemDescription} {
        grid-row: 1;
        grid-column: 10 / span 3;
      }
    }
  }
`;

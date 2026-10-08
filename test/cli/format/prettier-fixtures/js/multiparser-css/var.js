const Something = styled.div`
  background: var(--${one}); /* ... */
  border: 1px solid var(--${two}); /* ... */
`;

const StyledPurchaseCard = styled(Card)`
  min-width: 200px;
  background-color: var(--${props => props.color});
  color: #fff;
`;

const v1 =  css`
prop: var(--global--color--${props.variant});
`;

const v2 = css`
        background-color: var(--global--color--${props.variant});

        &:hover {
          background-color: var(--global--color--${props.variant}__one);
        }
      `

export const StyledComponent = styled.div`
  grid-area:  area-${props => props.propName};
`

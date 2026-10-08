const ListItem1 = styled.li``;

const ListItem2 = styled.li` `;

const Dropdown = styled.div`position: relative;`

const Button = styled.button`
	  color:   palevioletred ;

	font-size : 1em   ;
`;

const TomatoButton = Button.extend`
	color  : tomato  ;

border-color : tomato
    ;

`;

Button.extend.attr({})`
border-color : black;
`

styled(ExistingComponent)`
       color : papayawhip ; background-color: firebrick`;


styled.button.attr({})`
border : rebeccapurple`;

styled(ExistingComponent).attr({})`
border : rebeccapurple`;

styled.div`
  color: ${props => props.theme.colors.paragraph};
  /* prettier-ignore */
  ${props => props.small ? 'font-size: 0.8em;' : ''};
`

styled.div`
  color: ${props => props.theme.colors.paragraph};
  /* prettier-ignore */
  ${props => props.small ? 'font-size: 0.8em;' : ''}
`

styled.div`
   /* prettier-ignore */
  color: ${props => props.theme.colors.paragraph};
  ${props => props.small ? 'font-size: 0.8em;' : ''};
`

styled.div`
  color: ${props => props.theme.colors.paragraph};
  /* prettier-ignore */
  ${props => props.small ? 'font-size: 0.8em;' : ''};
  /* prettier-ignore */
  ${props => props.red ? 'color: red;' : ''};
`

styled.div`
  /* prettier-ignore */
  color: ${props => props.theme.colors.paragraph};
  /* prettier-ignore */
  ${props => props.small ? 'font-size: 0.8em;' : ''};
  /* prettier-ignore */
  ${props => props.red ? 'color: red;' : ''};
  /* prettier-ignore */
`

styled.div`
 ${sanitize} ${fonts}
  html {
    margin: 0;
  }
`

styled.div`
  ${bar}
  baz
`

styled.span`
  foo
  ${bar}
  baz
`

styled.div`
  foo
  ${bar}
  ${baz}
`

styled.span`
  ${foo}
  ${bar}
`

styled.div`
  ${foo} bar
`

styled.span`
  ${foo} ${bar}
  baz: ${foo}
`

styled.span`
${foo};
${bar};
`

styled.span`
${foo}: ${bar};
`

styled.span`
${foo}: ${bar}
`

styled.span`
${foo}:
${bar}
`

styled.span`
${foo}:
${bar};
`

styled.a`
  ${feedbackCountBlockCss}
  text-decoration: none;

  ${FeedbackCount} {
    margin: 0;
  }
`

const StyledComponent1 = styled.div`
  ${anInterpolation}
  /* a comment */

  .aRule {
    color: red
  }
`;

const StyledComponent2 = styled.div`
  ${anInterpolation}

  /* a comment */

  .aRule {
    color: red
  }
`;

const Direction = styled.span`
  ${({ up }) => up && `color: ${color.positive};`}
  ${({ down }) => down && `color: ${color.negative};`}
`;

const Direction2 = styled.span`
  ${({ up }) => up && `color: ${color.positive}`};
  ${({ down }) => down && `color: ${color.negative}`};
`;

const mixin = css`
  color: ${props => props.color};
  ${props => props.otherProperty}: ${props => props.otherValue};
`;

const foo = styled.div`
  display: flex;
  ${props => props.useMixin && mixin}
`;

const Single1 = styled.div`
  color: red
`;

const Single2 = styled.div`
  color: red;
`;

const Dropdown2 = styled.div`
  /* A comment to avoid the prettier issue: https://github.com/prettier/prettier/issues/2291 */
  position: relative;
`;

const bar = styled.div`
  border-radius: 50%;
  border: 5px solid rgba(var(--green-rgb), 0);
  display: inline-block;
  height: 40px;
  width: 40px;

  ${props =>
    (props.complete || props.inProgress) &&
    css`
      border-color: rgba(var(--green-rgb), 0.15);
    `}

  div {
    background-color: var(--purpleTT);
    border-radius: 50%;
    border: 4px solid rgba(var(--purple-rgb), 0.2);
    color: var(--purpleTT);
    display: inline-flex;

    ${props =>
    props.complete &&
    css`
        background-color: var(--green);
        border-width: 7px;
      `}

    ${props =>
    (props.complete || props.inProgress) &&
    css`
        border-color: var(--green);
      `}
  }
`;

const A = styled.a`
  display: inline-block;
  color: #fff;
  ${props => props.a &&css`
    display: none;
  `}
   height: 30px;
`;

const Foo = styled.p`
  max-width: 980px;
  ${mediaBreakpointOnlyXs`
    && {
      font-size: 0.8rem;
    }
  `}

  &.bottom {
    margin-top: 3rem;
  }
`;

styled(A)`
  // prettier-ignore
  @media (aaaaaaaaaaaaa) {
	z-index: ${(props) => (props.isComplete ? '1' : '0')};
  }
`;

const StyledDiv = styled.div`
  ${props => getSize(props.$size.xs)}
  ${props => getSize(props.$size.sm, 'sm')}
  ${props => getSize(props.$size.md, 'md')}
`;

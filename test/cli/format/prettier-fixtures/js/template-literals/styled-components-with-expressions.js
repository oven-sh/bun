const Button = styled.a`
/* Comment */
	display: ${props=>props.display};
`;

styled.div`
	display: ${props=>props.display};
	border: ${props=>props.border}px;
	margin: 10px ${props=>props.border}px ;
`;

const EqualDivider = styled.div`
margin: 0.5rem;
		padding: 1rem;
	background: papayawhip    ;

	> * {
	flex: 1;

	&:not(:first-child) {
			${props => props.vertical ? 'margin-top' : 'margin-left'}: 1rem;
		}
	}
`;

const header = css`
.top-bar {background:black;
margin: 0;
    position: fixed;
	top: 0;left:0;
	width: 100%;
    text-align: center     ;
	padding: 15px  0  0  1em;
		z-index: 9999;
}

.top-bar .logo {
  height: 30px;
  margin: auto; 
    position: absolute;
	left: 0;right: 0;
}
`;

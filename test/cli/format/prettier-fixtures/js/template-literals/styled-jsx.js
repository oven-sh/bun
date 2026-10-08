<style jsx>{`
	/* a comment */
	div :global(.react-select) {
		color: red; display: none
	}
`}</style>;

<div>
<style jsx>{`
	/* a comment */
div :global(.react-select) {
color: red; display: none
}`}</style>
</div>;

<div>
<style jsx>{`div{color:red}`}</style>
</div>;

<div>
<style jsx>{`This is invalid css. 
      Shouldn't fail.
            Shouldn't be formatted.`}</style>
</div>;

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

const headerResolve = css.resolve`
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

const headerGlobal = css.global`
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

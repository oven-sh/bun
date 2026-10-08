const render1 = ({ styles }) => (
  <div style={styles} key="something">
    Keep the wrapping parens. Put each key on its own line.
  </div>
);

const render2 = ({ styles }) => <div style={styles} key="something">
  Create wrapping parens.
</div>;

const render3 = ({ styles }) => <div style={styles} key="something">Create wrapping parens.</div>;

const render4 = ({ styles }) => <div style={styles} key="something">Create wrapping parens and indent <strong>all the things</strong>.</div>;

const render5 = ({ styles }) => <div>Keep it on one line.</div>;

const render6 = ({ styles }) => (
  <div attr1="aaaaaaaaaaaaaaaaa" attr2="bbbbbbbbbbb" attr3="cccccccccccc">
    <div attr1="aaaaaaaaaaaaaaaaa" attr2="bbbbbbbbbbb" attr3="cccccccccccc" attr4>ddd d dd d d dddd dddd <strong>hello</strong></div>
    <div attr1="aaaaaaaaaaaaaaaaa" attr2="bbbbbbbbbbb" attr3="cccccccccccc" attr4>ddd d dd d d dddd dddd <strong>hello</strong></div>
    <div attr1="aaaaaaaaaaaaaaaaa" attr2="bbbbbbbbbbb" attr3="cccccccccccc" attr4>
      <div attr1="aaaaaaaaaaaaaaaaa" attr2="bbbbbbbbbbb" attr3="cccccccccccc" attr4>ddd d dd d d dddd dddd <strong>hello</strong></div> <strong>hello</strong></div>
  </div>
)

const render7 = () =>
  <div>
    <span /><span>Dont break each elem onto its own line.</span> <span />
    <div /> <div />
  </div>

const render7A = () => (
  <div>
    <div /><div /><div />
  </div>
)

const render7B = () => (
  <div>
    <span> <span/> Dont break plz</span>
    <span><span/>Dont break plz</span>
    <span>Dont break plz<span/></span>
  </div>
)

const render8 = (props) => <div>{props.text}</div>
const render9 = (props) => <div>{props.looooooooooooooooooooooooooooooong_text}</div>
const render10 = (props) => <div>{props.even_looooooooooooooooooooooooooooooooooooooooooonger_contents}</div>

const notJSX = (aaaaaaaaaaaaaaaaa, bbbbbbbbbbb) => this.someLongCallWithParams(aaaaaa, bbbbbbb).anotherLongCallWithParams(cccccccccccc, dddddddddddddddddddddd)

React.render(
  <BaseForm url="/auth/google" method="GET" colour="blue" size="large" submitLabel="Sign in with Google" />
  , document.querySelector('#react-root')
)


const renderTernary = (props) =>
  <BaseForm url="/auth/google" method="GET" colour="blue" size="large" submitLabel="Sign in with Google">
    {props.showTheThing ?
      <BaseForm url="/auth/google" method="GET" colour="blue" size="large" submitLabel="Sign in with Google">Hello world</BaseForm>
      : "hello " + "howdy! "}
    {props.showTheThing ?
      <BaseForm url="/auth/google" method="GET" colour="blue" size="large" submitLabel="Sign in with Google">Hello world</BaseForm>
      :
      null
    }
    {props.showTheThing ? null :
      <BaseForm url="/auth/google" method="GET" colour="blue" size="large" submitLabel="Sign in with Google">Hello world</BaseForm>
    }
    {props.showTheOtherThing ? <div>I am here</div> : <div attr="blah" />}
    {props.showTheOtherThing ? <div>I am here!!</div> : null}
  </BaseForm>

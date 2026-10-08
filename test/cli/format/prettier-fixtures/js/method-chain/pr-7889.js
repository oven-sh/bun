const Profile = view.with({ name: (state) => state.name }).as((props) => (
  <div>
    <h1>Hello, {props.name}</h1>
  </div>
))

const Profile2 = view.with({ name }).as((props) => (
  <div>
    <h1>Hello, {props.name}</h1>
  </div>
))

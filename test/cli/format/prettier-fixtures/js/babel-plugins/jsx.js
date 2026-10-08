// https://babeljs.io/docs/babel-plugin-syntax-jsx

var profile = <div>
  <img src="avatar.png" className="profile" />
  <h3>{[user.firstName, user.lastName].join(' ')}</h3>
</div>;

const UsersList = ({ users }) => (
  <section>
    <h2>Users list</h2>
    <ul>
      {users.map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  </section>
)

const TodoList = ({ todos }) => (
  <div className="TodoList">
    <ul>{_.map(todos, (todo, i) => <TodoItem key={i} {...todo} />)}</ul>
  </div>
);

<div className="search-filter-chips">
    {scopes
        .filter(scope => scope.value !== '')
        .map((scope, i) => (
            <FilterChip
                query={this.props.query}
                onFilterChosen={this.onSearchScopeClicked}
                key={i}
                value={scope.value}
                name={scope.name}
            />
        ))}
</div>

<div>
  {__DEV__
    ? this.renderDevApp()
    : <div>
      {routes.map(route => (
        <MatchAsync
          key={`${route.to}-async`}
          pattern={route.to}
          exactly={route.to === "/"}
          getComponent={routeES6Modules[route.value]}
        />
      ))}
    </div>}
</div>;

<div>
  {__DEV__ && <div>
    {routes.map(route => (
      <MatchAsync
        key={`${route.to}-async`}
        pattern={route.to}
        exactly={route.to === "/"}
        getComponent={routeES6Modules[route.value]}
      />
    ))}
    </div>}
</div>;

<div>
  {member.memberName.memberSomething +
    (member.memberDef.memberSomething.signatures ? '()' : '')}
</div>

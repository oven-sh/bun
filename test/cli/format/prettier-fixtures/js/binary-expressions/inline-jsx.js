const user = renderedUser || <div><User name={this.state.user.name} age={this.state.user.age} /></div>;

const user2 = renderedUser || shouldRenderUser && <div><User name={this.state.user.name} age={this.state.user.age} /></div>;

const avatar = hasAvatar && <Gravatar user={author} size={size} />;

const avatar2 = (hasAvatar || showPlaceholder) && <Gravatar user={author} size={size} />;

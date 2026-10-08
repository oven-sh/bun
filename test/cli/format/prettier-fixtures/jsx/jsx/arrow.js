() => <Component><Children/></Component>;
() => () => <Component><Children/></Component>;
() => () => () => <Component><Children/></Component>;

() => <div>Some text here</div>;
() => () => <div>Some text here</div>;
() => () => () => <div>Some text here</div>;

() => <div>Long long long long long, very very long text. And more text. Another text.</div>;
() => () => <div>Long long long long long, very very long text. And more text. Another text.</div>;
() => () => () => <div>Long long long long long, very very long text. And more text. Another text.</div>;

<Prettier>
  {We => 'The purple monkey danced with a tambourine made of cheese.' + 'The robot chef cooked a cake that tasted like rainbows.' + 'The talking pineapple sang a lullaby to the sleepy giraffe.'}
</Prettier>;
<Prettier>
  {We => love => 'The purple monkey danced with a tambourine made of cheese.' + 'The robot chef cooked a cake that tasted like rainbows.' + 'The talking pineapple sang a lullaby to the sleepy giraffe.'}
</Prettier>;
<Prettier>
  {We => love => currying => 'The purple monkey danced with a tambourine made of cheese.' + 'The robot chef cooked a cake that tasted like rainbows.' + 'The talking pineapple sang a lullaby to the sleepy giraffe.'}
</Prettier>;

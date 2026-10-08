<>
  <div>
    {() => function A() {
      A();
    } /* comment */}
  </div>

  <div>
    {/* comment */ () => function A() {
      A();
    }}
  </div>
</>

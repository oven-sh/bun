<div>
  {a || "b"}
</div>;

<div>
  {a && "b"}
</div>;

<div>
  {a || <span></span>}
</div>;

<div>
  {a && <span></span>}
</div>;

<div>
  {a && <span>make this text just so long enough to break this to the next line</span>}
</div>;

<div>
  {a && b && <span>make this text just so long enough to break this to the next line</span>}
</div>;

<div>
  {a && <span>
    <div>
      <div></div>
    </div>
  </span>}
</div>;

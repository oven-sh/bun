x =
  <fbt>
    <fbt:param>
      First
    </fbt:param>,
    <fbt:param>
      Second
    </fbt:param>
  </fbt>

x =
  <fbt>
    <fbt:param>
      First
    </fbt:param>
    ,
    <fbt:param>
      Second
    </fbt:param>
  </fbt>

x =
  <fbt>
    <fbt:param>First</fbt:param>,<fbt:param>Second</fbt:param>
  </fbt>

x =
  <fbt>
    <fbt:param>
      First
    </fbt:param>,<fbt:param>
      Second
    </fbt:param>
  </fbt>

x =
  <fbt desc="example 1">
    Prefix comes before
    <fbt:param>
      <b>
        suffix
      </b>
    </fbt:param>
  </fbt>

x =
  <fbt desc="example 2">
    Prefix comes before
    <fbt:param name="bold stuff">
      <b>
      suffix
      </b>
    </fbt:param>
    <fbt:param name="a link">
      <link href="#">
        suffix
      </link>
    </fbt:param>
  </fbt>

x =
  <fbt desc="example 3">
    Count Chocula knows the the number
    <fbt:enum enum-range={['one', 'two', 'three']} value={getValue()} />
    is awesome
  </fbt>

x = (
  <fbt>
    {hour}:{minute}:{second}
  </fbt>
);

x = (
  <fbt>
    {hour}
    :
    {minute}
    :
    {second}
  </fbt>
);

x = (
  <fbt>
    {hour}:
    {minute}:
    {second}
  </fbt>
);

first = (
  <fbt>
    Text<br />
    More text<br />
    And more<br />
  </fbt>
);

second = (
  <fbt>
    Text<br />More text<br />And more<br />
  </fbt>
);

third = (
  <fbt>
    Text
    <br />
    More text
    <br />
    And more
    <br />
  </fbt>
);

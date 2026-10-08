keep = <p>
  Welcome to the <strong>Universal React Starter-kyt</strong>.
  This starter kyt should serve as the base for an advanced,
  server-rendered React app.
</p>

newlines_text =
  <div>
    hi
    there
    how

    are you


    are you fine today?
  </div>

newlines_text_spaced =
  <div>

    space above

    space below

  </div>

newlines_elems_spaced =
  <div>

    <span>space above</span>

    <span>space below</span>

  </div>

newlines_mixed =
  <div>
    hi
    <span>there</span>

    how

    are <strong>you</strong>


    are you fine today?
  </div>

newlines_elems =
  <div>
    <div>


      <div></div>


    </div>


    hi


    <div></div>


    <span />


    <Big />


  </div>

regression_extra_newline = (
  <div>
    <span
      className="nuclide-console-new-messages-notification-icon icon icon-nuclicon-arrow-down"
    />
    New Messages
  </div>
);


regression_extra_newline_2 = (
  <div>
    (
    <FormattedMessage
      id="some-id"
      defaultMessage="some loooooooooooooooooooooooooooong default"
    />
    )
  </div>
);

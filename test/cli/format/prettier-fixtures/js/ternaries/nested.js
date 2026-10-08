let icecream = what == "cone"
  ? p => !!p ? `here's your ${p} cone` : `just the empty cone for you`
  : p => `here's your ${p} ${what}`;

const value = condition1
? value1
: condition2
    ? value2
    : condition3
        ? value3
        : value4;


const StorybookLoader = ({ match }) => (
  match.params.storyId === "button"
    ? <ButtonStorybook />
    : match.params.storyId === "color"
    ? <ColorBook />
    : match.params.storyId === "typography"
    ? <TypographyBook />
    : match.params.storyId === "loading"
    ? <LoaderStorybook />
    : match.params.storyId === "deal-list"
    ? <DealListStory />
    : (
      <Message>
        <Title>{'Missing story book'}</Title>
        <Content>
          <BackButton/>
        </Content>
      </Message>
    )
)

const message =
    i % 3 === 0 && i % 5 === 0 ?
        'fizzbuzz'
    : i % 3 === 0 ?
        'fizz'
    : i % 5 === 0 ?
        'buzz'
    :
        String(i)

const paymentMessage = state == 'success'
  ? 'Payment completed successfully'

: state == 'processing'
  ? 'Payment processing'

: state == 'invalid_cvc'
  ? 'There was an issue with your CVC number'

: state == 'invalid_expiry'
  ? 'Expiry must be sometime in the past.'

  : 'There was an issue with the payment.  Please contact support.'

const paymentMessage2 = state == 'success'
  ? 1 //'Payment completed successfully'

: state == 'processing'
  ? 2 //'Payment processing'

: state == 'invalid_cvc'
  ? 3 //'There was an issue with your CVC number'

: true //state == 'invalid_expiry'
  ? 4 //'Expiry must be sometime in the past.'

  : 5 // 'There was an issue with the payment.  Please contact support.'

const foo = <div className={'match-achievement-medal-type type' + (medals[0].record ? '-record' : (medals[0].unique ? '-unique' : medals[0].type))}>
	{medals[0].record ? (
		i18n('Record')
	) : medals[0].unique ? (
		i18n('Unique')
	) : medals[0].type === 0 ? (
		i18n('Silver')
	) : medals[0].type === 1 ? (
		i18n('Gold')
	) : medals[0].type === 2 ? (
		i18n('Platinum')
	) : (
		i18n('Theme')
	)}
</div>

a
    ? literalline
    : {
      123: 12
    }
    ? line
    : softline

const config = {
    onFailure: onFailure !== undefined ? onFailure :   (
      error => {
          notify(
              typeof error === 'string' ?
                  error
              : error.message || 'ra.notification.http_error',
              'warning',
              {
                  _:
                      typeof error === 'string' ? error
                      : error && error.message ? error.message
                      : undefined,
              }
          );
          refresh();
      }
    )
}

showNotification(
    typeof error === 'string' ? error :   error.message || body,
    level || 'warning',
    {
        messageArgs,
        undoable: false,
    }
)

const result = children && !isEmptyChildren(children)
  ? children
  : props.match
    ? component
      ? React.createElement(component, props)
      : render
        ? render(props)
        : null
    : null;

// @ts-nocheck
const isDropdown = true;
const iconName = "";
const adjustedPadding = 5;

const Icon = ({ name, size, color }) => {
  return name;
};

const Foo = <Icon name="arrow-down" size="1.5em" color="currentColor" />;
const yoooo = [<Icon name="arrow-down" size="1.5em" color="currentColor" />];
const iconProps = {
  // This regression test is to ensure that the JSX value here does not print as an e_missing (nothing)
  rightIcon: <Icon name="arrow-down" size="1.5em" color="currentColor" />,
  paddingRight: adjustedPadding,
};

export function test() {
  const foo = iconProps.rightIcon;
  yoooo[0];
  return testDone(import.meta.url);
}

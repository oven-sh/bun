import React from 'react';

/*
import styled from 'react-emotion';

const AspectRatioBox = styled.div`
  &::before {
    content: '';
    width: 1px;
    margin-left: -1px;
    float: left;
    height: 0;
    padding-top: ${props => 100 / props.aspectRatio}%;
  }

  &::after {
    /* To clear float *//*
    content: '';
    display: table;
    clear: both;
  }
`;
*/

const AspectRatioBox = ({
  aspectRatio,
  children,
  ...props
}) => (
  <div
    className={`height: 0;
  overflow: hidden;
  padding-top: ${props => 100 / props.aspectRatio}%;
  background: white;
  position: relative;`}
  >
    <div>{children}</div>
  </div>
);

export default AspectRatioBox;

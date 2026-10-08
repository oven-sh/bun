import React from "react";
import { Used, div, Member, Unused, _under, $dollar } from "x";
const a = <Used attr={1}><div /><Member.x /><_under /><$dollar /></Used>;
function scope() { const React = 1; return <></>; }
export { a, scope };

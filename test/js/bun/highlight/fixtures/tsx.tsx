import React, { useState, type ReactNode } from "react";
import styled, { css } from "styled-components";
import { gql } from "@apollo/client";

const accent = "#f472b6";

const Button = styled.button<{ $primary?: boolean }>`
  color: ${accent};
  padding: 0.25em 1em;
  &:hover { background: rgb(0 0 0 / 10%); }
  ${props => props.$primary && css`
    background: ${accent};
    color: white;
  `}
`;

const QUERY = gql`
  query User($id: ID!) {
    user(id: $id) { name, friends(first: 10) @include(if: true) { ...Friend } }
  }
`;

interface Props<T> {
  items: T[];
  render(item: T): ReactNode;
  title?: string;
}

export function List<T extends { id: number }>({ items, render, title = "Items" }: Props<T>) {
  const [open, setOpen] = useState<boolean>(false);
  return (
    <section className="list" data-open={open} aria-label="a &amp; b">
      <h1 style={{ color: accent }}>{title} &mdash; "quoted" text</h1>
      {/* a comment */}
      <Button $primary onClick={() => setOpen(!open)} {...{ disabled: false }}>
        Toggle
      </Button>
      <>
        {open && items.map(item => <li key={item.id}>{render(item)}</li>)}
      </>
      <React.Fragment />
      <svg:rect xlink:href="#a" />
      <my-element></my-element>
    </section>
  );
}

const less = 1 < 2 && 3 > 2;
const shifted = (1 << 2) >> 1;
const map = new Map<string, Array<Set<number>>>();
void QUERY, less, shifted, map;

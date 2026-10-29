import { Fragment, type ReactNode } from "react";

interface Section {
  id: string;
  title: string;
  paragraphs: string[][];
  quote: string | null;
  points: string[];
}

const vocabulary =
  "the of and to in a is that for it as was with be by on not he his but at are this have from or had an they which one you were her all she there would their we him been has when who will more no if out so said what up its about into than them can only other new some could time these two may then do first any my now such like our over man me even most made after also did many before must through back years where much your way well down should because each just those people how too little state good very make world still own see men work long get here between both life being under never day same another know while last might us great old year off come since against go came right used take three".split(
    " ",
  );

function makeSections(count: number): Section[] {
  let seed = 777;
  const next = (below: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % below;
  };
  const sentence = (length: number) => {
    const picked = Array.from({ length }, () => vocabulary[next(vocabulary.length)]);
    picked[0] = picked[0][0].toUpperCase() + picked[0].slice(1);
    if (next(5) === 0) picked[next(length)] = `"${picked[1]}" & <${picked[2]}>`;
    return `${picked.join(" ")}.`;
  };
  return Array.from({ length: count }, (_, index) => ({
    id: `section-${index}`,
    title: sentence(4 + next(4)).slice(0, -1),
    paragraphs: Array.from({ length: 3 + next(3) }, () => Array.from({ length: 4 + next(4) }, () => sentence(9 + next(14)))),
    quote: next(3) === 0 ? sentence(18) : null,
    points: next(2) === 0 ? Array.from({ length: 3 + next(3) }, () => sentence(6 + next(5))) : [],
  }));
}

const sections = makeSections(60);

function Sentence({ text, position }: { text: string; position: number }): ReactNode {
  if (position % 7 === 3) return <em>{text}</em>;
  if (position % 11 === 5) return <a href={`#note-${position}`}>{text}</a>;
  return text;
}

function Paragraph({ sentences }: { sentences: string[] }) {
  return (
    <p>
      {sentences.map((text, position) => (
        <Fragment key={position}>
          <Sentence text={text} position={position} />{" "}
        </Fragment>
      ))}
    </p>
  );
}

function Part({ section }: { section: Section }) {
  return (
    <section id={section.id}>
      <h2>{section.title}</h2>
      {section.paragraphs.map((sentences, index) => (
        <Paragraph key={index} sentences={sentences} />
      ))}
      {section.quote && <blockquote>{section.quote}</blockquote>}
      {section.points.length > 0 && (
        <ul>
          {section.points.map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Article() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>A long read</title>
      </head>
      <body>
        <nav aria-label="Contents">
          <ol>
            {sections.map(section => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ol>
        </nav>
        <article>
          <h1>A long read</h1>
          {sections.map(section => (
            <Part key={section.id} section={section} />
          ))}
        </article>
      </body>
    </html>
  );
}

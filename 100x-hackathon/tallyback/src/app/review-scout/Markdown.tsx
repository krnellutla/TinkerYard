import type { ReactNode } from "react";

// Just enough Markdown for the summaries: headings, bullets, numbered lists, **bold**, *italic*,
// [links](https://…) and bare https:// links. Links open in a new tab; nothing but http(s) becomes a link.
// Link text can't contain brackets: models often wrap citations as "[[Channel @ 01:00](url), …]".
const INLINE = /\[([^[\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`|(https?:\/\/[^\s)\]]+)/g;

const link = (key: number, href: string, label: string) => (
  <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="font-medium underline decoration-line underline-offset-2 hover:decoration-ink">
    {label}
  </a>
);

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = m.index;
    if (m[2]) out.push(link(key, m[2], m[1]));
    else if (m[3]) out.push(<strong key={key}>{m[3]}</strong>);
    else if (m[4]) out.push(<em key={key}>{m[4]}</em>);
    else if (m[5]) out.push(<code key={key} className="rounded bg-paper px-1 font-mono text-[0.85em]">{m[5]}</code>);
    else out.push(link(key, m[6], m[6]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={blocks.length} className={`${list.ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5`}>
        {list.items.map((it, i) => (
          <li key={i}>{inline(it)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    blocks.push(
      heading ? (
        <p key={blocks.length} className="pt-1 font-semibold">
          {inline(heading[1])}
        </p>
      ) : (
        <p key={blocks.length}>{inline(line)}</p>
      ),
    );
  }
  flush();
  return <div className="space-y-2 text-[0.95rem] leading-relaxed">{blocks}</div>;
}

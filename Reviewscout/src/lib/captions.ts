// Turning YouTube caption files into transcript text. Pure functions, so they're easy to test.

const MAX_CHARS_PER_VIDEO = 12_000; // ~2,000 words; keeps 8 videos well inside the context window

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "") // word-timing tags inside a line
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// Caption files come in two XML shapes: <p t="ms"> (format 3) or <text start="s"> (format 1).
export function parseCaptions(xml: string): { start: number; text: string }[] {
  const rows: { start: number; text: string }[] = [];
  for (const m of xml.matchAll(/<p\b[^>]*\bt="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) rows.push({ start: Number(m[1]) / 1000, text: decode(m[2]) });
  if (!rows.length)
    for (const m of xml.matchAll(/<text\b[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)) rows.push({ start: Number(m[1]), text: decode(m[2]) });
  return rows.filter((r) => r.text);
}

// The spoken review as text, with an [mm:ss] marker roughly every minute.
export function withMinuteMarks(snippets: { start: number; text: string }[]): string {
  const parts: string[] = [];
  let nextMark = 0;
  for (const { start, text } of snippets) {
    if (start >= nextMark) {
      const s = Math.floor(start);
      parts.push(`\n[${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}]`);
      nextMark = start + 60;
    }
    parts.push(text);
  }
  return parts.join(" ").slice(0, MAX_CHARS_PER_VIDEO);
}

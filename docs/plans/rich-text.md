# Rich text in finding details

Status: proposed.

## Recommendation

Render a finding's detail with inline markdown: bold, italic, inline code, strikethrough and https links. Parse it once in shared code, and draw the result in each client with its own styles. Keep asks, outcomes and titles plain for now.

## What each client can draw

- **Claude terminal and desktop panes.** `Text` takes `bold`, `italic`, `underline`, `strikethrough`, `color` and `backgroundColor`, and a `Text` can nest inside a wrapping `Text`. Desktop draws each as a styled span, in a proportional font. So both panes can draw every style above.
- **The engine's `Markdown` element.** It draws text the way an assistant reply is drawn, with links, tables and code fences. The PR block already uses it. How it lays out inside a tree row, and whether desktop link clicks reach it, is untested.
- **Codex tab.** Plain HTML. Preact escapes text, so `<b>`, `<i>`, `<code>`, `<s>` and `<a>` built from parsed spans are safe. Links take only `https:`.

Markdown has no underline, so underline stays out.

## Design

- **A shared parser.** `hooks/inline.ts` exports `parseInline(text)`, which returns spans: `{ text, bold?, italic?, code?, strike?, link? }`. An unmatched marker stays literal text. No dependency: the mod imports nothing from npm, and the Codex bundle already includes `hooks/`.
- **Claude panes.** Draw each span as a nested `Text`. Inline code takes the file-name color the finding row already uses. Draw a link as its text, plus a `Link` for https.
- **Codex tab.** Draw each span as its HTML element.
- **Text that is compared or clipped stays plain.** `restates` and `keyWords` compare asks, and the clip helpers can cut a `**` pair in half. A `stripInline` helper gives them plain text. Details are parsed after any clip.

## What the models are told today

- The `record_finding` description asks for "why it matters and what you would do, in one or two sentences". It says nothing about markdown, so details may already carry it.
- The inbox model's rules end with "No markdown". That covers asks and outcomes, which stay plain.

Allowing markdown in details is text a model reads, so it needs an A/B run first.

## Tests

- `parseInline` on paired, unmatched and nested markers, and on a link with a non-https scheme.
- A clipped detail still draws.
- HTML in a detail comes out escaped in the Codex tab.

## Risks

- Desktop's proportional font makes inline code look weaker than in the terminal.
- Saved findings keep their raw text, so this needs no state upgrade.

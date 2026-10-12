# Rich text in finding details

Status: built for finding details. Asks, outcomes and titles stay plain.

## What it does

A finding's detail draws its inline markdown: bold, italic, strikethrough, inline code and https links. `parseInline` in `hooks/inline.ts` turns the text into styled spans. Each client draws the spans with its own styles. An unmatched marker stays as text.

The models were not told to write markdown. Details already carry it, as the agents write it on their own.

## What each client can draw

- **Claude terminal and desktop panes.** `Text` takes `bold`, `italic`, `underline`, `strikethrough`, `color` and `backgroundColor`, and a `Text` can nest inside a wrapping `Text`. Desktop draws each as a styled span, in a proportional font. So both panes can draw every style above.
- **The engine's `Markdown` element.** It draws text the way an assistant reply is drawn, with links, tables and code fences. The PR block already uses it. How it lays out inside a tree row, and whether desktop link clicks reach it, is untested.
- **Codex tab.** Plain HTML. Preact escapes text, so elements built from parsed spans are safe.

Markdown has no underline, so underline stays out.

## How each client draws it

- **Claude panes.** Each span is a nested `Text`. Inline code takes Claude Code's own code color, as the file name does.
- **Codex tab.** Each span is an element: `<b>`, `<i>`, `<s>` and `<code>`, which takes the file name's look. Preact escapes the text, so no HTML gets through.
- **Links, in every client.** The label is underlined, then the URL follows in muted text. Neither Claude pane documents a `Link` inside a line of text, and a plain anchor's click in the Codex tab's frame is untested.

## What the models are told today

- The `record_finding` description asks for "why it matters and what you would do, in one or two sentences". It says nothing about markdown, so details may already carry it.
- The inbox model's rules end with "No markdown". That covers asks and outcomes, which stay plain.

Asking the models to write markdown would change text they read, so it would need an A/B run first.

## Checked

- `parseInline` has a test for each style, nesting, and unmatched markers.
- The Codex test page drew every style.
- A live terminal pane drew bold, strikethrough, code color and underline. Italic could not be seen there, since the tmux terminal type has no italics.
- Desktop is not checked yet.

## Risks

- Desktop's proportional font makes inline code look weaker than in the terminal.
- Saved findings keep their raw text, so this needs no state upgrade.

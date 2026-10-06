# mermaid-c4-zoom

A [Claude Code mod](https://claude.com/blog/claude-code-mods) that draws
mermaid diagrams in a side pane, as colored text art right in your
terminal. Boxes can open: click one and the pane shows the diagram one
level inside it, the way the C4 model goes from a system to its
containers to their components.

Ask Claude "draw the architecture of this repo, and let me zoom into the
API" and you get this in the pane, each box in its own pastel color:

```
╭───────────────────╮
│                   │
│    Users (^o^)/   │
│ browser and phone │
╰─────────┬─────────╯
          │
          │
          ▼
╭───────────────────╮
│                   │
│Load balancer (>_<)│
│ one at a time pls │
╰─────────┬─────────╯
          │
          │
          ▼
╭───────────────────╮
│                   │
│App servers (^w^) ▸│
│  many tiny clones │
╰─────────┬─────────╯
          │
          ├─────────────────────╮
          ▼                     ▼
╭───────────────────╮  ╭────────────────╮
│                   │  │                │
│    Redis (^v^)    │  │Postgres (-_-) ▸│
│    snack drawer   │  │ the big diary  │
╰───────────────────╯  ╰────────────────╯
```

Click `App servers ▸` or press its number, and the pane shows what is
inside the app servers. Press `u` to come back up.

## Install

```
claude plugin marketplace add testy-cool/mermaid-c4-zoom
claude plugin install mermaid-c4-zoom@mermaid-c4-zoom
```

Then run `/reload-plugins` in an open session, or start a new one.

## Use it

- Ask Claude for a diagram. It calls the `show_diagram` tool the mod
  gives it, and the pane opens beside the conversation.

- Any ```` ```mermaid ```` block Claude writes in a reply shows up in
  the pane too.

- `/diagrams` opens or closes the pane.

- `‹` and `›` page between the diagrams of the session. `remove this
  one` drops the one on screen.

- A box with `▸` opens a level. Click its label, or focus the pane
  (`ctrl+x` then `tab`) and press its number. `‹ up` or `u` goes back.

## Zoom levels

Claude sends the levels in one call. `zoom` maps a node id of a diagram
to the diagram inside that node, nested as deep as you like:

```json
{
  "title": "Web app",
  "mermaid": "graph TD\n  U[Users] --> APP[App servers]\n  APP --> DB[Postgres]",
  "zoom": {
    "APP": {
      "title": "Inside the app",
      "mermaid": "graph TD\n  R[Router] --> H[Handlers]",
      "zoom": { "H": { "title": "Inside a handler", "mermaid": "graph TD\n  A[Check input] --> B[Build page]" } }
    }
  }
}
```

A zoom key that names no `[box]` or `{diamond}` node, or a level that
does not parse, is refused with the reason, so Claude can fix it.

## What it draws

Flowcharts (`graph` and `flowchart`), `sequenceDiagram`,
`stateDiagram-v2`, `classDiagram`, `erDiagram` and `xychart-beta`. Pie
charts are not supported. Zoom works on flowchart boxes and diamonds.

## Limits

- The pane docks beside the transcript in the fullscreen layout from 110
  columns. Narrower, it opens above the prompt.

- When Claude opens the pane by itself, it needs 144 columns. `/diagrams`
  opens it at any width.

- Clickable labels draw in the plain text color, because a Claude Code
  button cannot take a color.

- Wide diagrams are cut at the pane's right edge, with a note saying so.
  Top-down (`graph TD`) fits best.

## Credits

The text art comes from [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid)
(MIT), bundled with patches by [prismantis](https://github.com/NahumLitvin/prismantis)
(MIT). The coloring is adapted from prismantis. Their licenses are in
`hooks/vendor/`.

## License

MIT

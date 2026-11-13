---
"@blitzcraftlabs/atlas": minor
"@atlas/project": minor
---

Custom generators: declare consumer-owned generators in `atlas.config.json#generators` (template
directory, target path, placeholders such as `{{pascal}}`) and run them with
`atlas generate <id> <name>`. `atlas generate list` and `atlas context` include them with
`source: "custom"`.

# mve-output-filter

Standalone, zero-dependency Node.js CLI for applying ordered regular-expression replacements to text before Markdown/HTML/PDF generation.

It does not depend on VS Code or Markdown Easy Visual Editor, so the same transformation rules can be used locally, in build scripts, and in CI/CD.

## Requirements

Node.js 20 or later.

## Configuration

Create a JSON file:

```json
{
  "rules": [
    {
      "name": "omit-internal-block",
      "pattern": "<!--\\s*internal:start\\s*-->[\\s\\S]*?<!--\\s*internal:end\\s*-->",
      "flags": "gi",
      "replacement": ""
    },
    {
      "name": "replace-version",
      "pattern": "\\{\\{VERSION\\}\\}",
      "replacement": "1.5.3"
    }
  ]
}
```

Rules are applied from top to bottom. The `g` flag is always enabled so every hit is transformed. An empty `replacement` removes the hit.

Replacement strings use JavaScript `String.replace` semantics, so `$1`, `$2`, `$&`, and named captures such as `$<name>` are available.

## CLI

Write to stdout:

```sh
node ./bin/mve-output-filter.mjs input.md --config ./rules.json > filtered.md
```

Write to a file:

```sh
node ./bin/mve-output-filter.mjs input.md --config ./rules.json --output filtered.md
```

Replace the source file atomically:

```sh
node ./bin/mve-output-filter.mjs input.md --config ./rules.json --in-place
```

Use stdin/stdout in a pipeline:

```sh
cat input.md | node ./bin/mve-output-filter.mjs - --config ./rules.json > filtered.md
```

CI check mode does not write files. It exits with code 1 when the configured transformation would change the input, 0 when it would not, and 2 for configuration/runtime errors.

```sh
node ./bin/mve-output-filter.mjs input.md --config ./rules.json --check
```

For a machine-readable match summary, add `--report-json`. The JSON report is written to stderr so stdout remains safe for transformed content.

## GitHub Actions example

```yaml
- uses: actions/checkout@v4

- uses: actions/setup-node@v4
  with:
    node-version: 20

- name: Filter document
  run: |
    node tools/mve-output-filter/bin/mve-output-filter.mjs docs/manual.md \
      --config .mve-output-filter.json \
      --output build/manual.md
```

The resulting `build/manual.md` can then be passed to any Markdown-to-HTML or PDF generator.

## Rule behavior

- Any number of rules can be configured.
- Rules run sequentially.
- `enabled: false` temporarily disables a rule.
- Empty replacement means omission.
- Invalid regular expressions fail before output is written.
- File writes use a temporary file and rename, preventing partially-written output.
- The tool executes regular expressions only; it does not execute arbitrary JavaScript from configuration.

User-supplied regular expressions can still be computationally expensive. Treat CI configuration as trusted project configuration.

# Hermes plugin maintenance

`hermes-plugin/` packages the MCP server as a portable Hermes plugin (Agent
Plugins v1.0.0). Installation and user configuration live in
[`hermes-plugin/README.md`](../hermes-plugin/README.md); this document covers
building, validation, and release status.

## Build and verify

```bash
pnpm build:plugin
pnpm test:plugin
hermes plugins validate ./hermes-plugin --json
```

`build:plugin` runs `pnpm build` and then bundles `src/mcp/main.ts` with
esbuild. `test:plugin` spawns the bundle over stdio with the MCP SDK and checks
the schema, example, validation, rendering, provider list, and policy rejection.

`hermes plugins validate` runs the real loader and is the release gate. Fix
diagnostics against the installed Hermes version rather than an older report or
sample manifest.

## Package contract

- The invocation is `--transport stdio --no-env`, so no env file is read.
  `AGENTS_AUTOMATIONS_HOME` is `${PLUGIN_DATA}`.
- Credentials and `AGENTS_AUTOMATIONS_ALLOW_*` policy are forwarded by name in `mcp.json`
  (`"OPENAI_API_KEY": "${OPENAI_API_KEY}"`), and `test/hermes-plugin.test.ts`
  asserts that list. A new setting the plugin should honour must be added to
  both.
- If the host leaves an entry unexpanded, the server sees the literal
  `${NAME}` and treats it as unset, so keys fail pre-flight and policy stays
  denied rather than being granted by accident.
- `trust: untrusted` makes state-changing tools require confirmation.
  Read-only tools carry `readOnlyHint: true`.
- `AGENTS_AUTOMATIONS_ALLOW_*` grants dangerous permissions; the server's defaults are deny,
  but `init` offers every permission ticked and writes `true` for each one
  the user keeps.
- The committed bundle exists because Hermes does not build the plugin during
  install.

## Install and publish status

The plugin is installed from GitHub, by `install.sh` / `install.ps1` or by
hand; nothing is published to npm. The GitHub repository is not public yet, so
the GitHub form of the install fails until it is; the `file://` form works from
a clone today. License is MIT.

Installation changes `~/.hermes` and is deliberately separate from the build.
After validation succeeds and the user approves:

```bash
hermes plugins validate ./hermes-plugin --json
hermes plugins install "file://$PWD#hermes-plugin" --enable                # from a clone
hermes plugins install Bruce-Hopkins/agents-automations/hermes-plugin --enable   # once public
```

The installer's setup runs the second form when Hermes is ticked, after saving
the settings. Start a new
Hermes session after enabling, and run `hermes gateway restart` if
the gateway is running. `hermes plugins update agents-automations` pulls the committed
bundle from the install source, so rebuild and commit `dist/` before updating.
Hermes fills the `${NAME}` entries in `mcp.json` from `~/.hermes/.env` or its
own environment when it connects; an unset name stays literal.

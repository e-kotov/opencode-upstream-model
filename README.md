# opencode-upstream-model

An OpenCode 2 plugin that shows the model a gateway says *actually* answered,
in the prompt footer's status row:

```text
~/project    gpt-5.6-terra-mitarbeitende · vllm    2.6K (1%)  ctrl+p commands
```

A route is the provider's deployment slot (`GPT5-Mitarbeitende`). The slot name
is stable by design; the model behind it is not, and nothing on the request
side reveals a swap. The local gateway recovers the identity from the untouched
upstream response and republishes it as `x-gateway-upstream-*` headers; this
plugin reads those headers and displays them.

This is the maintained source of the integration that was previously deployed
only from Mac chezmoi as `plugins/upstream-model-{server.js,tui.tsx}`. Those
OpenCode 1 files are preserved byte-for-byte in [`legacy/v1/`](legacy/v1/) for
reference; they do not load in OpenCode 2.

## How it works

| File | Job |
|---|---|
| `src/server.js` | server half: `session.hook("http.response")`, scoped to each configured provider, parses the headers and keeps the identity per session in plugin storage |
| `src/rpc.mjs` | the `upstream-model` RPC: `identity({ sessionID })` and the `updated` event |
| `src/tui.tsx` | TUI half: appends to the `prompt.footer.status` slot |
| `src/logic.mjs` | parsing, trust rule and formatting; pure |
| `src/status-store.mjs`, `src/remote-status.mjs` | per-session storage and its TUI mirror |

OpenCode 2 passes the native response together with its session and model, so
there is no `fetch` wrapper and no internal routing header. The hook reads
headers only; the response body is never consumed.

Trust rule: the model counts as confirmed only when
`x-gateway-upstream-model-source` is `response.model` or `provider-metadata`.
Anything else, notably `response.model-echo`, renders with a trailing `?`. An
engine fingerprint (`x-gateway-upstream-engine`) is shown on its own when no
model is reported. Header values are bounded and rejected if they contain line
breaks.

An identity recorded for one provider is hidden once a different provider has
answered the session, and reappears if the session returns to it.

State is kept in the plugin's own storage, not in session metadata: in
OpenCode 1 several plugins wrote session metadata, and because a metadata
update replaces the whole object they dropped each other's keys.

## Install

```sh
./install.sh                         # into ~/.config/opencode (XDG-aware)
./install.sh --providers saia,kiconnect,other
./install.sh --dest DIR --remove-legacy
```

The installer copies `src/` into `<config>/plugins/upstream-model/`, which
OpenCode 2 discovers without registration. `--providers` writes the server
plugin's options to `opencode.json`; without it no configuration file is
touched. `--remove-legacy` deletes this plugin's OpenCode 1 files from
`plugins/`, which OpenCode 2 would otherwise try to load as plugins.

As a package, `.`/`./server` is the server half, `./tui` the TUI half and
`./rpc` the RPC definition.

## Test

```sh
npm test
```

No build step and no runtime dependencies; the tests use Node's runner and a
stand-in for the OpenCode 2 plugin context.

## Licence

MIT.

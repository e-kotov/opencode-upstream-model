/** @jsxImportSource @opentui/solid */

// Renders the model that ACTUALLY answered, next to the prompt.
//
// The server half (`upstream-model-server.js`) reads the gateway's
// `x-gateway-upstream-*` headers and stores them on the session; this only
// displays them. See that file for why the model behind a route cannot be known
// from the request side.

import type { TuiPluginApi, TuiPluginModule, TuiSlotProps } from "@opencode-ai/plugin/tui"

type UpstreamModelProps = Pick<TuiSlotProps<"session_prompt_right">, "session_id">

export function displayUpstreamModel(value: unknown) {
  if (!value || typeof value !== "object") return ""

  const identity = value as Record<string, unknown>
  const model = typeof identity.model === "string" ? identity.model.trim() : ""
  const engine = typeof identity.engine === "string" ? identity.engine.trim() : ""
  // The engine fingerprint stands on its own: when the provider echoes the name
  // we sent, it is the only real evidence we have.
  if (!model) return engine

  // An echoed name is the provider repeating what we sent, so it is not proof of
  // the underlying model. Mark it rather than present it as confirmed.
  const suffix = identity.confirmed === false ? "?" : ""

  return engine ? `${model}${suffix} · ${engine}` : `${model}${suffix}`
}

const plugin: TuiPluginModule = {
  id: "upstream-model-tui",
  tui: async (api: TuiPluginApi) => {
    function UpstreamModel(props: UpstreamModelProps) {
      const text = () =>
        displayUpstreamModel(api.state.session.get(props.session_id)?.metadata?.upstreamModel)

      return (
        <box height={1} minWidth={0} flexShrink={1} overflow="hidden">
          <text height={1} wrapMode="none" truncate fg={api.theme.current.textMuted}>
            {text()}
          </text>
        </box>
      )
    }

    api.slots.register({
      // After saia-limits (100) so the quota figures stay leftmost.
      order: 110,
      slots: {
        session_prompt_right(_context, props) {
          return <UpstreamModel session_id={props.session_id} />
        },
      },
    })
  },
}

export default plugin

// Installed plugin files can be evaluated as CommonJS outside this repository's
// package boundary; keep the default and named helper usable either way.
if (typeof module !== "undefined") {
  module.exports = plugin
  module.exports.default = plugin
  module.exports.displayUpstreamModel = displayUpstreamModel
}

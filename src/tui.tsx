/** @jsxImportSource @opentui/solid */

// OpenCode 2 TUI half: renders the model that ACTUALLY answered, in the prompt
// footer's status row.
//
// The server half (`server.js`) reads the gateway's `x-gateway-upstream-*`
// headers and keeps them per session; this only displays them, fetched over
// the `upstream-model` RPC and kept current by its `updated` event.

import type { Plugin } from "@opencode/plugin/tui"
import { displayUpstreamModel, visibleIdentity } from "./logic.mjs"
import { createRemoteStatus } from "./remote-status.mjs"
import { UpstreamModelRpc } from "./rpc.mjs"

const plugin: Plugin.Definition = {
  id: "upstream-model-tui",
  setup(context) {
    const remote = createRemoteStatus(context, UpstreamModelRpc, { method: "identity", field: "identity" })

    const text = (sessionID: string | undefined) => {
      if (!sessionID) return ""
      try {
        const identity = visibleIdentity(
          remote.get(sessionID),
          context.data.session.message.list(sessionID),
          context.data.session.get(sessionID),
        )
        return displayUpstreamModel(identity)
      } catch {
        // A widget must never take the prompt row down with it.
        return ""
      }
    }

    context.ui.slot({
      append: "prompt.footer.status",
      render: (input) => (
        <box height={1} flexShrink={0}>
          <text height={1} wrapMode="none" truncate fg={context.theme.text.muted}>
            {text(input.sessionID)}
          </text>
        </box>
      ),
    })

    return () => remote.dispose()
  },
}

export default plugin

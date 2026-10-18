// OpenCode 2 server half: record which model ACTUALLY answered each session.
//
// The gateway republishes the upstream identity as `x-gateway-upstream-*`
// response headers (see logic.mjs). OpenCode 2 hands every native provider
// response to `session.hook("http.response")` together with the session it
// belongs to, so no `fetch` wrapper or internal routing header is needed: the
// hook is scoped to the configured providers and only reads headers, never the
// body. Identities are kept per session in plugin storage and served to the
// TUI half (`tui.tsx`) over the `upstream-model` RPC.
//
// The same hook also carries title, compaction and generate requests
// (`event.kind`), often on the configured small model. Only a `primary`
// request answers the session, so only it may set the identity.

import { identityFrom, identityKey, normaliseProviders } from "./logic.mjs"
import { UpstreamModelRpc } from "./rpc.mjs"
import { createStatusStore, headerBag } from "./status-store.mjs"

export function createUpstreamModelPlugin({ now = () => new Date(), onWarning } = {}) {
  return {
    id: "upstream-model-server",
    async setup(ctx) {
      const warn = onWarning ?? ((message) => console.warn(`[upstream-model] ${message}`))
      const providers = normaliseProviders(ctx.options?.providers)
      let announce
      const store = createStatusStore({
        storage: ctx.storage,
        keyOf: identityKey,
        onWarning: warn,
        emit: (sessionID, identity) => announce?.(sessionID, identity),
      })

      const registration = await ctx.rpc.register(UpstreamModelRpc, {
        identity: async (input) => {
          const sessionID = typeof input?.sessionID === "string" ? input.sessionID : undefined
          return { identity: (await store.get(sessionID)) ?? null }
        },
      })
      announce = (sessionID, identity) => registration.events.emit("updated", { sessionID, identity })

      const observe = (event) => {
        if (event?.kind !== undefined && event.kind !== "primary") return
        const identity = identityFrom(headerBag(event.response?.headers), now())
        if (!identity) return
        identity.providerID = event.model?.providerID
        // Never hold the provider response back on our own bookkeeping.
        void store.update(event.sessionID, () => identity)
      }
      for (const providerID of providers) {
        await ctx.session.hook("http.response", observe, { providerID })
      }

      return () => store.flush()
    },
  }
}

export default createUpstreamModelPlugin()

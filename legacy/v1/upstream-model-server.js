// Publish what model ACTUALLY answered into session metadata, for the TUI.
//
// A route is the provider's own deployment slot (`GPT5-Mitarbeitende`), which is
// why the picker can show it verbatim. The slot name is stable by design; the
// model behind it is not, and nothing in the request, the model catalogue, or
// `/v1/models` reveals a swap. Only the response body does — and LiteLLM's proxy
// overwrites that field with the route name before the client sees it.
//
// The gateway therefore recovers the true identity from the untouched upstream
// body and republishes it as `x-gateway-upstream-*` headers. This reads them off
// the provider response and stores them on the session, where the TUI half
// (`upstream-model-tui.tsx`) renders them.
//
// Deliberately a sibling of saia-limits-server rather than an edit to it: that
// file tracks an upstream project, and this covers both providers.

const INTERNAL_SESSION_HEADER = "x-opencode-upstream-session"
const WRAPPED_FETCH = Symbol.for("brain-gateway.upstream-model-fetch")
const PROVIDERS = ["saia", "kiconnect"]

function requestURL(input) {
  try {
    if (typeof input === "string") return new URL(input)
    if (input instanceof URL) return input
    if (input && typeof input.url === "string") return new URL(input.url)
  } catch {}
}

// Match only the configured provider base URL. A missing or malformed base URL
// disables interception rather than guessing an endpoint.
function providerOrigin(options) {
  try {
    if (options?.baseURL) return new URL(options.baseURL).origin
  } catch {}
}

function requestHeaders(input, init) {
  const headers = new Headers()
  const inputHeaders = input instanceof Request ? input.headers : input?.headers
  if (inputHeaders) new Headers(inputHeaders).forEach((value, key) => headers.set(key, value))
  if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  return headers
}

function unwrap(result) {
  if (result && typeof result === "object" && "data" in result) return result.data
  return result
}

// The source tokens that count as evidence, shared with Prime's extension
// (extensions/logic.mjs:34). Anything else — notably `response.model-echo`, the
// provider repeating the name we sent — is not independent evidence of what is
// underneath, so the model renders as unconfirmed.
const CONFIRMED_SOURCES = new Set(["response.model", "provider-metadata"])

function identityFrom(response) {
  const model = response.headers.get("x-gateway-upstream-model")
  // An engine fingerprint alone is still worth showing: it is what SAIA gives
  // us when it echoes the requested name back.
  const engine = response.headers.get("x-gateway-upstream-engine") ?? undefined
  if (!model && !engine) return

  return {
    model,
    engine,
    confirmed: CONFIRMED_SOURCES.has(response.headers.get("x-gateway-upstream-model-source")),
    observedAt: response.headers.get("x-gateway-upstream-observed-at") ?? undefined,
    updatedAt: new Date().toISOString(),
  }
}

async function saveIdentity(client, sessionID, identity) {
  const transport = client?._client
  if (!transport || typeof transport.get !== "function" || typeof transport.patch !== "function") {
    throw new Error("OpenCode's HTTP client is unavailable")
  }
  const current = unwrap(await transport.get({ url: "/session/{sessionID}", path: { sessionID } }))
  const metadata =
    current?.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
      ? current.metadata
      : {}

  await transport.patch({
    url: "/session/{sessionID}",
    path: { sessionID },
    headers: { "Content-Type": "application/json" },
    body: { metadata: { ...metadata, upstreamModel: identity } },
  })
}

export function createUpstreamModelHooks(client, { onWarning = console.warn } = {}) {
  const pendingWrites = new Map()
  const lastSeen = new Map()

  function enqueueSave(sessionID, identity) {
    // Only write when the answer actually changed — this fires on every response.
    const key = `${identity.model}|${identity.engine ?? ""}`
    if (lastSeen.get(sessionID) === key) return
    lastSeen.set(sessionID, key)

    const previous = pendingWrites.get(sessionID) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(() => saveIdentity(client, sessionID, identity))
    pendingWrites.set(sessionID, current)
    void current.then(
      () => {
        if (pendingWrites.get(sessionID) === current) pendingWrites.delete(sessionID)
      },
      (error) => {
        onWarning(
          `[upstream-model] Failed to save identity: ${error instanceof Error ? error.message : String(error)}`,
        )
        lastSeen.delete(sessionID)
        if (pendingWrites.get(sessionID) === current) pendingWrites.delete(sessionID)
      },
    )
  }

  async function flush() {
    while (pendingWrites.size > 0) await Promise.allSettled([...pendingWrites.values()])
  }

  return {
    config(config) {
      for (const providerID of PROVIDERS) {
        const options = config.provider?.[providerID]?.options
        if (!options) continue

        const originalFetch = options.fetch ?? globalThis.fetch
        if (typeof originalFetch !== "function" || originalFetch[WRAPPED_FETCH]) continue
        const origin = providerOrigin(options)

        const wrappedFetch = async function (input, init) {
          const url = requestURL(input)
          if (!origin || url?.origin !== origin) return originalFetch.call(this, input, init)

          const headers = requestHeaders(input, init)
          const sessionID = headers.get(INTERNAL_SESSION_HEADER)
          if (!sessionID) return originalFetch.call(this, input, init)

          // Routing state for this client only; it must not reach the gateway.
          headers.delete(INTERNAL_SESSION_HEADER)
          const response = await originalFetch.call(this, input, { ...init, headers })
          const identity = identityFrom(response)
          if (identity) enqueueSave(sessionID, identity)
          return response
        }

        Object.defineProperty(wrappedFetch, WRAPPED_FETCH, { value: true })
        options.fetch = wrappedFetch
      }
    },

    "chat.headers"(input, output) {
      if (!PROVIDERS.includes(input.model.providerID)) return
      output.headers[INTERNAL_SESSION_HEADER] = input.sessionID
    },

    flush,
  }
}

export default {
  id: "upstream-model-server",
  server: async ({ client }) => createUpstreamModelHooks(client),
}

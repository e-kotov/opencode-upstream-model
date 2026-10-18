// Pure parsing and formatting for the upstream-model display. No I/O.
//
// A route is the provider's own deployment slot (`GPT5-Mitarbeitende`), which
// is why the picker can show it verbatim. The slot name is stable by design;
// the model behind it is not, and nothing in the request, the model catalogue
// or `/v1/models` reveals a swap. Only the response body does — and LiteLLM's
// proxy overwrites that field with the route name before the client sees it.
//
// The gateway therefore recovers the true identity from the untouched upstream
// body and republishes it as `x-gateway-upstream-*` response headers.

export const DEFAULT_PROVIDERS = Object.freeze(["saia", "kiconnect"])

// The source tokens that count as evidence, shared with Prime's extension and
// opencode-kiconnect-status. Anything else — notably `response.model-echo`, the
// provider repeating the name we sent — is not independent evidence of what is
// underneath, so the model renders as unconfirmed.
const CONFIRMED_SOURCES = new Set(["response.model", "provider-metadata"])

/** Header values are display metadata: bound them and reject line breaks. */
function displayValue(value, max = 160) {
  const text = typeof value === "string" ? value.trim() : ""
  return text && !/[\r\n]/.test(text) ? text.slice(0, max) : undefined
}

/** `headers` is a lower-cased name → value object. */
export function identityFrom(headers, now = new Date()) {
  const h = headers ?? {}
  const model = displayValue(h["x-gateway-upstream-model"])
  // An engine fingerprint alone is still worth showing: it is what SAIA gives
  // us when it echoes the requested name back.
  const engine = displayValue(h["x-gateway-upstream-engine"], 80)
  if (!model && !engine) return undefined

  const observedAt = displayValue(h["x-gateway-upstream-observed-at"], 40)
  return {
    model: model ?? null,
    ...(engine ? { engine } : {}),
    confirmed: CONFIRMED_SOURCES.has(h["x-gateway-upstream-model-source"]),
    ...(observedAt ? { observedAt } : {}),
    updatedAt: now.toISOString(),
  }
}

/** Only these fields decide whether a stored identity needs rewriting. */
export function identityKey(identity) {
  if (!identity) return "null"
  return JSON.stringify([
    identity.model ?? null,
    identity.engine ?? null,
    identity.confirmed === true,
    identity.providerID ?? null,
  ])
}

export function displayUpstreamModel(value) {
  if (!value || typeof value !== "object") return ""

  const model = typeof value.model === "string" ? displayValue(value.model) ?? "" : ""
  const engine = typeof value.engine === "string" ? displayValue(value.engine, 80) ?? "" : ""
  // The engine fingerprint stands on its own: when the provider echoes the name
  // we sent, it is the only real evidence we have.
  if (!model) return engine

  // An echoed name is the provider repeating what we sent, so it is not proof
  // of the underlying model. Mark it rather than present it as confirmed.
  const suffix = value.confirmed === false ? "?" : ""
  return engine ? `${model}${suffix} · ${engine}` : `${model}${suffix}`
}

/**
 * The identity to show for a session, or undefined. An identity recorded for
 * one provider is not shown once another provider has answered the session.
 */
export function visibleIdentity(identity, messages, session) {
  if (!identity || typeof identity !== "object") return undefined
  if (typeof identity.providerID !== "string") return identity
  const answering = answeringProvider(messages, session)
  return answering === undefined || answering === identity.providerID ? identity : undefined
}

export function normaliseProviders(value) {
  if (!Array.isArray(value)) return [...DEFAULT_PROVIDERS]
  const providers = value.filter((item) => typeof item === "string" && /^[\w.-]{1,80}$/.test(item))
  return providers.length ? [...new Set(providers)] : [...DEFAULT_PROVIDERS]
}

/**
 * The provider that answered the session's newest completed assistant message,
 * read from OpenCode 2's encoded session messages. Falls back to the session's
 * selected model before the first answer.
 */
export function answeringProvider(messages, session) {
  const list = Array.isArray(messages) ? messages : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index]
    if (message?.type !== "assistant") continue
    if (typeof message.time?.completed !== "number") continue
    return message.model?.providerID
  }
  return session?.model?.providerID
}

import assert from "node:assert/strict"
import test from "node:test"

import { answeringProvider, displayUpstreamModel, identityFrom, normaliseProviders, visibleIdentity } from "../src/logic.mjs"
import { createRemoteStatus } from "../src/remote-status.mjs"
import { UpstreamModelRpc } from "../src/rpc.mjs"
import { fakeTuiContext } from "./fake-context.mjs"

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test("identityFrom keeps the trust rule and bounds header values", () => {
  assert.equal(identityFrom({}), undefined)
  assert.equal(identityFrom({ "x-gateway-upstream-model": "a\nb" }), undefined)
  const identity = identityFrom(
    { "x-gateway-upstream-model": "x".repeat(400), "x-gateway-upstream-model-source": "provider-metadata" },
    new Date(0),
  )
  assert.equal(identity.model.length, 160)
  assert.equal(identity.confirmed, true)
  assert.deepEqual(identityFrom({ "x-gateway-upstream-engine": "vllm" }, new Date(0)), {
    model: null,
    engine: "vllm",
    confirmed: false,
    updatedAt: "1970-01-01T00:00:00.000Z",
  })
})

test("displayUpstreamModel matches the v1 rendering", () => {
  assert.equal(displayUpstreamModel({ model: "m", engine: "e", confirmed: true }), "m · e")
  assert.equal(displayUpstreamModel({ model: "m", confirmed: false }), "m?")
  assert.equal(displayUpstreamModel({ model: null, engine: "e" }), "e")
  assert.equal(displayUpstreamModel(undefined), "")
})

test("answeringProvider reads OpenCode 2 encoded messages", () => {
  const messages = [
    { type: "user", time: { created: 1 } },
    { type: "assistant", model: { providerID: "kiconnect", id: "a" }, time: { created: 2, completed: 3 } },
    // Still streaming: not an answer yet.
    { type: "assistant", model: { providerID: "openai", id: "b" }, time: { created: 4 } },
  ]
  assert.equal(answeringProvider(messages), "kiconnect")
  assert.equal(answeringProvider([], { model: { providerID: "saia", id: "x" } }), "saia")
})

test("visibleIdentity hides an identity once another provider has answered", () => {
  const identity = { model: "m", providerID: "kiconnect" }
  const ki = [{ type: "assistant", model: { providerID: "kiconnect" }, time: { completed: 1 } }]
  const other = [...ki, { type: "assistant", model: { providerID: "openai" }, time: { completed: 2 } }]
  assert.equal(visibleIdentity(identity, ki), identity)
  assert.equal(visibleIdentity(identity, other), undefined)
  assert.equal(visibleIdentity(identity, []), identity)
})

test("normaliseProviders defaults and filters", () => {
  assert.deepEqual(normaliseProviders(undefined), ["saia", "kiconnect"])
  assert.deepEqual(normaliseProviders(["a", "a", "bad id!", 3]), ["a"])
})

test("remote status fetches once per session with the session's location and follows events", async () => {
  const { context, calls, publish, listeners } = fakeTuiContext({
    sessions: { ses_1: { id: "ses_1", location: { directory: "/work" } } },
    rpc: { identity: async ({ sessionID }) => ({ identity: { model: `m-${sessionID}` } }) },
  })
  const remote = createRemoteStatus(context, UpstreamModelRpc, { method: "identity", field: "identity" })
  assert.equal(remote.get("ses_1"), undefined)
  remote.get("ses_1")
  await tick()
  await tick()
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].options, { location: { directory: "/work" } })
  assert.deepEqual(remote.get("ses_1"), { model: "m-ses_1" })

  publish({ type: "rpc.upstream-model.updated", data: { sessionID: "ses_1", identity: { model: "new" } } })
  assert.deepEqual(remote.get("ses_1"), { model: "new" })
  publish({ type: "rpc.other.updated", data: { sessionID: "ses_1", identity: { model: "ignored" } } })
  assert.deepEqual(remote.get("ses_1"), { model: "new" })

  remote.dispose()
  assert.equal(listeners.size, 0)
})

test("remote status yields nothing when the server half is missing", async () => {
  const { context } = fakeTuiContext()
  const remote = createRemoteStatus(context, UpstreamModelRpc, { method: "identity", field: "identity" })
  remote.get("ses_1")
  await tick()
  await tick()
  assert.equal(remote.get("ses_1"), undefined)
})

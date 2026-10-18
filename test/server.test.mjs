import assert from "node:assert/strict"
import test from "node:test"

import plugin, { createUpstreamModelPlugin } from "../src/server.js"
import { UpstreamModelRpc } from "../src/rpc.mjs"
import { fakeServerContext, responseEvent, settle } from "./fake-context.mjs"

const HEADERS = {
  "x-gateway-upstream-model": "gpt-5.6-terra",
  "x-gateway-upstream-model-source": "response.model",
  "x-gateway-upstream-engine": "vllm",
}

test("default export is a valid OpenCode 2 definition", () => {
  assert.equal(typeof plugin.id, "string")
  assert.ok(plugin.id.length > 0)
  assert.equal(typeof plugin.setup, "function")
  assert.equal("server" in plugin, false)
})

test("hooks http.response only for the configured providers", async () => {
  const fake = fakeServerContext()
  await createUpstreamModelPlugin().setup(fake.ctx)
  assert.deepEqual(
    fake.hooks.map((hook) => [hook.name, hook.providerID]),
    [
      ["http.response", "saia"],
      ["http.response", "kiconnect"],
    ],
  )

  const custom = fakeServerContext({ options: { providers: ["gateway-x"] } })
  await createUpstreamModelPlugin().setup(custom.ctx)
  assert.deepEqual(custom.hooks.map((hook) => hook.providerID), ["gateway-x"])
})

test("records the identity under the hook's session and serves it over RPC", async () => {
  const fake = fakeServerContext()
  await createUpstreamModelPlugin({ now: () => new Date("2026-10-17T00:00:00Z") }).setup(fake.ctx)
  await fake.trigger("http.response", responseEvent({ sessionID: "ses_a", headers: HEADERS }))
  await settle()

  const [registration] = fake.registrations
  assert.equal(registration.definition, UpstreamModelRpc)
  const output = await registration.handlers.identity({ sessionID: "ses_a" })
  assert.deepEqual(output.identity, {
    model: "gpt-5.6-terra",
    engine: "vllm",
    confirmed: true,
    updatedAt: "2026-10-17T00:00:00.000Z",
    providerID: "kiconnect",
  })
  assert.deepEqual(await registration.handlers.identity({ sessionID: "ses_other" }), { identity: null })
  assert.deepEqual(fake.storage.get("session/ses_a"), output.identity)
  assert.deepEqual(fake.emitted.map((event) => [event.type, event.data.sessionID]), [["rpc.upstream-model.updated", "ses_a"]])
})

test("does not rewrite or re-announce an unchanged identity", async () => {
  const fake = fakeServerContext()
  let clock = 0
  await createUpstreamModelPlugin({ now: () => new Date(clock++ * 1000) }).setup(fake.ctx)
  for (let index = 0; index < 3; index += 1) {
    await fake.trigger("http.response", responseEvent({ headers: HEADERS }))
  }
  await settle()
  assert.equal(fake.emitted.length, 1)

  await fake.trigger("http.response", responseEvent({ headers: { ...HEADERS, "x-gateway-upstream-model": "other" } }))
  await settle()
  assert.equal(fake.emitted.length, 2)
  assert.equal(fake.storage.get("session/ses_1").model, "other")
})

test("an echoed model is stored as unconfirmed and responses without evidence are ignored", async () => {
  const fake = fakeServerContext()
  await createUpstreamModelPlugin().setup(fake.ctx)
  await fake.trigger("http.response", responseEvent({ headers: { "x-unrelated": "1" } }))
  await settle()
  assert.equal(fake.storage.size, 0)

  await fake.trigger(
    "http.response",
    responseEvent({ headers: { "x-gateway-upstream-model": "GPT5", "x-gateway-upstream-model-source": "response.model-echo" } }),
  )
  await settle()
  assert.equal(fake.storage.get("session/ses_1").confirmed, false)
})

test("a stored identity survives a restart and the hook never consumes the body", async () => {
  const first = fakeServerContext()
  await createUpstreamModelPlugin().setup(first.ctx)
  const event = responseEvent({ headers: HEADERS })
  await first.trigger("http.response", event)
  assert.equal(event.response.bodyUsed, false)
  await settle()

  const second = fakeServerContext({ stored: Object.fromEntries(first.storage) })
  await createUpstreamModelPlugin().setup(second.ctx)
  const output = await second.registrations[0].handlers.identity({ sessionID: "ses_1" })
  assert.equal(output.identity.model, "gpt-5.6-terra")
})

test("cleanup waits for pending writes", async () => {
  const fake = fakeServerContext()
  const slow = fake.ctx.storage.set
  fake.ctx.storage.set = async (key, value) => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    return slow(key, value)
  }
  const cleanup = await createUpstreamModelPlugin().setup(fake.ctx)
  await fake.trigger("http.response", responseEvent({ headers: HEADERS }))
  assert.equal(fake.storage.size, 0)
  await cleanup()
  assert.equal(fake.storage.size, 1)
})

test("title, compaction and generate requests never replace the primary identity", async () => {
  const fake = fakeServerContext()
  const stop = await createUpstreamModelPlugin().setup(fake.ctx)
  const headers = (model) => ({ "x-gateway-upstream-model": model, "x-gateway-upstream-model-source": "response.model" })
  await fake.trigger(
    "http.response",
    responseEvent({ sessionID: "ses_a", modelID: "big", kind: "primary", headers: headers("upstream-big") }),
  )
  await settle()
  for (const kind of ["title", "compaction", "generate"]) {
    await fake.trigger(
      "http.response",
      responseEvent({ sessionID: "ses_a", modelID: "small", kind, headers: headers(`upstream-small-${kind}`) }),
    )
  }
  await settle()
  await stop()
  assert.equal(fake.storage.get("session/ses_a").model, "upstream-big")
  // A session whose only response so far is auxiliary has no identity yet.
  const other = fakeServerContext()
  await createUpstreamModelPlugin().setup(other.ctx)
  await other.trigger("http.response", responseEvent({ sessionID: "ses_b", kind: "title", headers: headers("small") }))
  await settle()
  assert.equal(other.storage.get("session/ses_b"), undefined)
})

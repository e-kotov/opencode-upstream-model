// RPC contract between the server and TUI halves.
//
// A plain object rather than `Rpc.define(...)`: that helper is an identity
// function that only rejects error names starting with `rpc.`, and importing
// `@opencode/plugin/rpc` would stop the Node test suite loading this module.

export const UpstreamModelRpc = {
  id: "upstream-model",
  methods: {
    identity: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: { type: "object" },
    },
  },
  events: {
    updated: {
      schema: {
        type: "object",
        properties: { sessionID: { type: "string" }, identity: { type: "object" } },
        required: ["sessionID"],
      },
    },
  },
}

export const UPDATED_EVENT = `rpc.${UpstreamModelRpc.id}.updated`

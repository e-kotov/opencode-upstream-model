import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const install = (dest, ...args) =>
  execFileSync("bash", [path.join(root, "install.sh"), "--dest", dest, ...args], { encoding: "utf8", stdio: "pipe" })

test("installs a self-contained OpenCode 2 plugin directory", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "upstream-model-install-"))
  install(dest)
  const dir = path.join(dest, "plugins", "upstream-model")
  assert.deepEqual(fs.readdirSync(dir).sort(), [
    "logic.mjs",
    "package.json",
    "remote-status.mjs",
    "rpc.mjs",
    "server.js",
    "status-store.mjs",
    "tui.tsx",
  ])
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).type, "module")
  // Nothing loose in plugins/, which OpenCode 2 would load as a plugin.
  assert.deepEqual(fs.readdirSync(path.join(dest, "plugins")), ["upstream-model"])
  // No options requested: no config written.
  assert.equal(fs.existsSync(path.join(dest, "opencode.json")), false)
})

test("--providers merges into opencode.json without disturbing other settings", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "upstream-model-install-"))
  fs.writeFileSync(
    path.join(dest, "opencode.json"),
    JSON.stringify({ model: "x/y", plugins: ["other", { package: "/abs/plugins/upstream-model", options: { keep: 1 } }] }),
  )
  install(dest, "--providers", "saia,gateway")
  install(dest, "--providers", "kiconnect")
  const config = JSON.parse(fs.readFileSync(path.join(dest, "opencode.json"), "utf8"))
  assert.equal(config.model, "x/y")
  assert.deepEqual(config.plugins, [
    "other",
    { package: "./plugins/upstream-model", options: { keep: 1, providers: ["kiconnect"] } },
  ])
  assert.throws(() => install(dest, "--providers", "bad id"))
})

test("legacy OpenCode 1 files are reported, and removed only on request", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "upstream-model-install-"))
  fs.mkdirSync(path.join(dest, "plugins"), { recursive: true })
  fs.writeFileSync(path.join(dest, "plugins", "upstream-model-server.js"), "// v1")
  const kept = execFileSync("bash", [path.join(root, "install.sh"), "--dest", dest], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  assert.ok(fs.existsSync(path.join(dest, "plugins", "upstream-model-server.js")))
  assert.match(kept, /upstream-model/)
  install(dest, "--remove-legacy")
  assert.equal(fs.existsSync(path.join(dest, "plugins", "upstream-model-server.js")), false)
})

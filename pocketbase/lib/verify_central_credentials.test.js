const { test, expect } = require("bun:test")
const verify = require("./verify_central_credentials")

function run(modify = {}) {
  const calls = []
  const responses = [
    { access_token: "token", user: { id: "uid", email: "u@example.com" } },
    [{ profile_id: "legacy" }],
    [{ active: true, modules: ["analise_contas"] }],
    [{ id: "legacy", email: "u@example.com", status: "ativo" }],
  ]
  const http = { send(request) {
    calls.push(request)
    const n = calls.length - 1
    if (modify.fail === n) return { statusCode: 503, raw: "" }
    const value = modify[n] === undefined ? responses[n] : modify[n]
    return { statusCode: 200, raw: JSON.stringify(value) }
  } }
  const result = verify({ http, url: "https://example.test", publishableKey: "public", email: " U@example.com ", password: "password" })
  return { result, calls }
}
test("accepts central identity with active module and legacy profile", () => {
  const { result, calls } = run()
  expect(result).toEqual({ userId: "uid", profileId: "legacy", email: "u@example.com" })
  expect(calls[1].headers.Authorization).toBe("Bearer token")
})
test("denies failed authentication and transport failure", () => {
  expect(run({ fail: 0 }).result).toBeNull()
  expect(run({ fail: 2 }).result).toBeNull()
})
test("denies missing and duplicate links", () => {
  expect(run({ 1: [] }).result).toBeNull()
  expect(run({ 1: [{ profile_id: "x" }, { profile_id: "y" }] }).result).toBeNull()
})
test("denies inactive or unauthorized account", () => {
  expect(run({ 2: [{ active: false, modules: ["analise_contas"] }] }).result).toBeNull()
  expect(run({ 2: [{ active: true, modules: ["leitor_qr"] }] }).result).toBeNull()
})
test("denies mismatched or inactive profile", () => {
  expect(run({ 3: [{ id: "legacy", email: "other@example.com", status: "ativo" }] }).result).toBeNull()
  expect(run({ 3: [{ id: "legacy", email: "u@example.com", status: "inativo" }] }).result).toBeNull()
})

test("denies malformed HTTP responses without status code", () => {
  const http = { send() { return { raw: JSON.stringify({ access_token: "token", user: { id: "uid", email: "u@example.com" } }) } } }
  expect(verify({ http, url: "https://example.test", publishableKey: "public", email: "u@example.com", password: "password" })).toBeNull()
})

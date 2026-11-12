migrate(
  (app) => {
    try {
      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      const parsed = JSON.parse(existing.probe_raw || '{}')
      existing.summary = {}
      for (const k of Object.keys(parsed)) {
        existing.summary[k] = {
          ok: parsed[k]?.ok !== undefined ? parsed[k].ok : parsed[k]?.status,
          res: (parsed[k]?.text || parsed[k]?.raw || parsed[k]?.err || '').slice(0, 100),
        }
      }
      delete existing.probe_raw
      delete existing.t3_err
      delete existing.t4_err
      delete existing.t4_ok
      delete existing.t4_reply
      delete existing.t5_err
      delete existing.t5_ok
      delete existing.t5_reply
      rec.set('dados_especificos', existing)
      app.save(rec)
    } catch (_) {}
  },
  (app) => {},
)

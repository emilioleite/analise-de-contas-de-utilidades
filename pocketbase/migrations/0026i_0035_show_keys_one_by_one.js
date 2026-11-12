migrate(
  (app) => {
    try {
      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      const keys = existing.probe_keys || []
      // put in string fields we can see directly
      existing.k0 = keys[0] || ''
      existing.k1 = keys[1] || ''
      existing.k2 = keys[2] || ''
      existing.k3 = keys[3] || ''
      existing.k4 = keys[4] || ''
      existing.k5 = keys[5] || ''
      existing.k6 = keys[6] || ''
      delete existing.probe_keys
      rec.set('dados_especificos', existing)
      app.save(rec)
    } catch (_) {}
  },
  (app) => {}
)

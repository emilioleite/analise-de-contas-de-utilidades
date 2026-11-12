migrate(
  (app) => {
    try {
      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      delete existing.E_val
      delete existing.G_val
      delete existing.probe_status
      delete existing.__probe_ai_results
      delete existing.__probe_test
      rec.set('dados_especificos', existing)
      app.save(rec)
    } catch (_) {}
  },
  (app) => {},
)

migrate(
  (app) => {
    try {
      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      const sum = existing.summary || {}
      existing.probe_keys = Object.keys(sum).map(k => `${k}: ok=${sum[k].ok}, res=${sum[k].res}`)
      delete existing.summary
      rec.set('dados_especificos', existing)
      app.save(rec)
    } catch (_) {}
  },
  (app) => {}
)

migrate(
  (app) => {
    try {
      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      existing.E_val = existing.res_E ? existing.res_E.slice(0, 35) : ''
      existing.G_val = existing.res_G ? existing.res_G.slice(0, 35) : ''
      delete existing.res_D
      delete existing.res_E
      delete existing.res_G
      rec.set('dados_especificos', existing)
      app.save(rec)
    } catch (_) {}
  },
  (app) => {},
)

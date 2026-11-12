migrate(
  (app) => {
    try {
      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      existing.res_D = existing.D ? existing.D.slice(0, 50) : ''
      existing.res_E = existing.E ? existing.E.slice(0, 50) : ''
      existing.res_G = existing.G ? existing.G.slice(0, 50) : ''
      delete existing.A
      delete existing.C
      delete existing.D
      delete existing.E
      delete existing.F
      delete existing.G
      rec.set('dados_especificos', existing)
      app.save(rec)
    } catch (_) {}
  },
  (app) => {}
)

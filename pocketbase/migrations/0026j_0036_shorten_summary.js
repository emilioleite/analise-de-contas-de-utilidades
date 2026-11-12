migrate(
  (app) => {
    try {
      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      existing.A = existing.k0
      existing.C = existing.k2
      existing.D = existing.k3
      existing.E = existing.k4
      existing.F = existing.k5
      existing.G = existing.k6
      delete existing.k0
      delete existing.k1
      delete existing.k2
      delete existing.k3
      delete existing.k4
      delete existing.k5
      delete existing.k6
      rec.set('dados_especificos', existing)
      app.save(rec)
    } catch (_) {}
  },
  (app) => {}
)

migrate(
  (app) => {
    try {
      const pbUrl = $os.getenv('PB_INSTANCE_URL') || $os.getenv('SITE_URL')
      const resp = $http.send({
        url: `${pbUrl.replace(/\/+$/, '')}/backend/v1/test/probe-ai`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      existing.probe_raw = resp.raw ? resp.raw.slice(0, 1500) : ''
      existing.probe_status = resp.statusCode
      rec.set('dados_especificos', existing)
      app.save(rec)
    } catch (err) {
      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      existing.probe_err = err.message
      rec.set('dados_especificos', existing)
      app.save(rec)
    }
  },
  (app) => {}
)

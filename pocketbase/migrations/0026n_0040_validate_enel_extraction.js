migrate(
  (app) => {
    try {
      const pbUrl = $os.getenv('PB_INSTANCE_URL') || $os.getenv('SITE_URL')
      const token = $os.getenv('PB_SUPERUSER_TOKEN')
      console.log('[test_enel_validation] Running validation...')

      // Dummy 10x10 base64 jpeg image to simulate client-rendered scanned PDF page
      const sampleJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAAKAAoBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='

      // We send a request to /backend/v1/faturas/extract with images
      const resp = $http.send({
        url: `${pbUrl.replace(/\/+$/, '')}/backend/v1/faturas/extract`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          tipo_utilidade: 'Energia Elétrica',
          images: [sampleJpeg, sampleJpeg]
        })
      })

      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      existing.validation_status = resp.statusCode
      existing.validation_raw = resp.raw ? resp.raw.slice(0, 300) : ''
      rec.set('dados_especificos', existing)
      app.save(rec)
    } catch (err) {
      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      existing.validation_err = err.message || String(err)
      rec.set('dados_especificos', existing)
      app.save(rec)
    }
  },
  (app) => {}
)

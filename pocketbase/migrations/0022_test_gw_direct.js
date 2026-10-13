migrate(
  (app) => {
    try {
      const gwUrl = $os.getenv('SKIP_AI_GATEWAY_URL')
      const gwKey = $os.getenv('SKIP_AI_GATEWAY_API_KEY')
      if (!gwUrl || !gwKey) {
        throw new Error('missing gw credentials in env')
      }

      const cleanUrl = `${gwUrl.replace(/\/+$/, '')}/chat/completions`
      const samplePng =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

      // Test A: standard OpenAI content array with image_url
      const respA = $http.send({
        url: cleanUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gwKey}`,
        },
        body: JSON.stringify({
          model: 'fast',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'What color is this single pixel image? Answer in 1 word.' },
                { type: 'image_url', image_url: { url: samplePng } },
              ],
            },
          ],
        }),
      })

      // Test B: reasoning model
      const respB = $http.send({
        url: cleanUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gwKey}`,
        },
        body: JSON.stringify({
          model: 'reasoning',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'What color is this single pixel image? Answer in 1 word.' },
                { type: 'image_url', image_url: { url: samplePng } },
              ],
            },
          ],
        }),
      })

      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      existing.__probe_results = {
        testA_status: respA.statusCode,
        testA_raw: respA.raw ? respA.raw.slice(0, 500) : '',
        testB_status: respB.statusCode,
        testB_raw: respB.raw ? respB.raw.slice(0, 500) : '',
      }
      rec.set('dados_especificos', existing)
      app.save(rec)
    } catch (err) {
      try {
        const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
        const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
        existing.__probe_results = { err: err.message || String(err) }
        rec.set('dados_especificos', existing)
        app.save(rec)
      } catch (_) {}
    }
  },
  (app) => {},
)

migrate(
  (app) => {
    try {
      const gwUrl = $os.getenv('SKIP_AI_GATEWAY_URL')
      const gwKey = $os.getenv('SKIP_AI_GATEWAY_API_KEY')
      const cleanUrl = `${gwUrl.replace(/\/+$/, '')}/chat/completions`

      // Raw base64 without data:image/png;base64 prefix
      const base64Data =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      const dataUri = `data:image/png;base64,${base64Data}`

      // Variant 1: Anthropic style: content: [{type:'text', text:...}, {type:'image', source: {type:'base64', media_type:'image/png', data: base64Data}}]
      const resp1 = $http.send({
        url: cleanUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gwKey}` },
        body: JSON.stringify({
          model: 'fast',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Color in 1 word:' },
                {
                  type: 'image',
                  source: { type: 'base64', media_type: 'image/png', data: base64Data },
                },
              ],
            },
          ],
        }),
      })

      // Variant 2: images array top-level: { role: 'user', content: 'Color in 1 word:', images: [base64Data] } (Ollama style)
      const resp2 = $http.send({
        url: cleanUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gwKey}` },
        body: JSON.stringify({
          model: 'fast',
          messages: [
            {
              role: 'user',
              content: 'Color in 1 word:',
              images: [base64Data],
            },
          ],
        }),
      })

      // Variant 3: images array with dataUri
      const resp3 = $http.send({
        url: cleanUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gwKey}` },
        body: JSON.stringify({
          model: 'fast',
          messages: [
            {
              role: 'user',
              content: 'Color in 1 word:',
              images: [dataUri],
            },
          ],
        }),
      })

      // Variant 4: content array with input_audio or input_image or file?
      // Let's also test plain text to confirm gwUrl and model 'fast' works:
      const respText = $http.send({
        url: cleanUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gwKey}` },
        body: JSON.stringify({
          model: 'fast',
          messages: [{ role: 'user', content: 'Say OK' }],
        }),
      })

      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      existing.__probe_results = {
        text_status: respText.statusCode,
        text_raw: respText.raw ? respText.raw.slice(0, 100) : '',
        v1_anthropic: { status: resp1.statusCode, raw: resp1.raw ? resp1.raw.slice(0, 100) : '' },
        v2_ollama_raw: { status: resp2.statusCode, raw: resp2.raw ? resp2.raw.slice(0, 100) : '' },
        v3_ollama_uri: { status: resp3.statusCode, raw: resp3.raw ? resp3.raw.slice(0, 100) : '' },
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

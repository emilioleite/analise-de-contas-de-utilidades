migrate(
  (app) => {
    try {
      const gwUrl = $os.getenv('SKIP_AI_GATEWAY_URL')
      const gwKey = $os.getenv('SKIP_AI_GATEWAY_API_KEY')
      const cleanUrl = `${gwUrl.replace(/\/+$/, '')}/chat/completions`

      // 10x10 white jpeg
      const sampleJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAAKAAoBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='

      // Test A: with detail: "high"
      const resA = $http.send({
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
                { type: 'image_url', image_url: { url: sampleJpeg, detail: 'high' } }
              ]
            }
          ]
        })
      })

      // Test B: with image_url as string or without detail
      const resB = $http.send({
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
                { type: 'image_url', image_url: { url: sampleJpeg } }
              ]
            }
          ]
        })
      })

      // Test C: via $ai.chat directly
      let resCStatus = 'ok'
      let resCRaw = ''
      try {
        const c = $ai.chat({
          model: 'fast',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Color in 1 word:' },
                { type: 'image_url', image_url: { url: sampleJpeg, detail: 'high' } }
              ]
            }
          ]
        })
        resCRaw = c.choices[0].message.content
      } catch (errC) {
        resCStatus = 'err: ' + (errC.message || String(errC))
      }

      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      existing.__probe_test = {
        testA_high: { status: resA.statusCode, raw: resA.raw ? resA.raw.slice(0, 200) : '' },
        testB_nodetail: { status: resB.statusCode, raw: resB.raw ? resB.raw.slice(0, 200) : '' },
        testC_ai_chat: { status: resCStatus, raw: resCRaw }
      }
      rec.set('dados_especificos', existing)
      app.save(rec)
    } catch (err) {
      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      existing.__probe_test = { global_err: err.message || String(err) }
      rec.set('dados_especificos', existing)
      app.save(rec)
    }
  },
  (app) => {}
)

migrate(
  (app) => {
    try {
      console.log('[probe_test_vision] Testando chamada com content parts multimodal...')
      const gwUrl = $os.getenv('SKIP_AI_GATEWAY_URL')
      const gwKey = $os.getenv('SKIP_AI_GATEWAY_API_KEY')
      if (!gwUrl || !gwKey) return
      const cleanUrl = `${gwUrl.replace(/\/+$/, '')}/chat/completions`

      // 1x1 pixel gif/png em data:image
      const dummyImg =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

      // Teste fast com content array
      const respFast = $http.send({
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
                {
                  type: 'text',
                  text: 'Descreva sucintamente ou retorne json {"img_received": true}',
                },
                { type: 'image_url', image_url: { url: dummyImg } },
              ],
            },
          ],
        }),
      })
      console.log(
        '[probe_test_vision] fast resp status:',
        respFast.statusCode,
        'body:',
        respFast.raw ? respFast.raw.slice(0, 200) : '',
      )

      // Teste reasoning com content array
      const respReas = $http.send({
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
                {
                  type: 'text',
                  text: 'Descreva sucintamente ou retorne json {"img_received": true}',
                },
                { type: 'image_url', image_url: { url: dummyImg } },
              ],
            },
          ],
        }),
      })
      console.log(
        '[probe_test_vision] reasoning resp status:',
        respReas.statusCode,
        'body:',
        respReas.raw ? respReas.raw.slice(0, 200) : '',
      )
    } catch (err) {
      console.log('[probe_test_vision] Erro:', err.message || err)
    }
  },
  (app) => {},
)

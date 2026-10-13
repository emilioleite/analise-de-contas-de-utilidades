migrate(
  (app) => {
    try {
      const gwUrl = $os.getenv('SKIP_AI_GATEWAY_URL')
      const gwKey = $os.getenv('SKIP_AI_GATEWAY_API_KEY')
      console.log('[probe-gw] URL exists:', !!gwUrl, 'Key exists:', !!gwKey)
      if (gwUrl && gwKey) {
        const cleanUrl = `${gwUrl.replace(/\/+$/, '')}/chat/completions`
        // Test standard prompt asking to extract numbers
        const resp = $http.send({
          url: cleanUrl,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${gwKey}`,
          },
          body: JSON.stringify({
            model: 'fast',
            messages: [{ role: 'user', content: 'Say hello world in json {"msg": "hello"}' }],
          }),
        })
        console.log(
          '[probe-gw] test text chat:',
          resp.statusCode,
          resp.raw ? resp.raw.slice(0, 150) : '',
        )
      }
    } catch (err) {
      console.log('[probe-gw] Error:', err.message || err)
    }
  },
  (app) => {},
)

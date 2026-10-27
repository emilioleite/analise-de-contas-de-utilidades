import PocketBase from 'pocketbase'

const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL)
pb.autoCancellation(false)

let refreshing: Promise<void> | null = null
pb.beforeSend = async (_url, options) => {
  const token = pb.authStore.token
  if (!token) return { url: _url, options }
  try {
    const payload = JSON.parse(atob(token.split('.')[1] || ''))
    const expSec = (payload.exp || 0) - Math.floor(Date.now() / 1000)
    if (expSec < 120) {
      if (!refreshing) {
        refreshing = pb
          .collection('users')
          .authRefresh()
          .then((a: any) => {
            if (a?.token) pb.authStore.save(a.token, a.record)
          })
          .catch(() => {})
          .finally(() => {
            refreshing = null
          })
      }
      await refreshing
    }
  } catch {
    /* token malformado: segue o fluxo normal */
  }
  return { url: _url, options }
}

export default pb

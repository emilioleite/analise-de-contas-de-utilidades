import { useEffect, useState } from 'react'

export function useCountUp(target: number, durationMs = 600): number {
  const safeTarget = Number.isFinite(target) ? target : 0
  const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 600
  const [value, setValue] = useState(safeTarget)

  useEffect(() => {
    if (!Number.isFinite(safeTarget)) {
      setValue(0)
      return
    }

    let startTimestamp: number | null = null
    const startValue = 0

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp
      const progress = Math.min((timestamp - startTimestamp) / safeDuration, 1)
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3)
      const current = startValue + (safeTarget - startValue) * ease
      setValue(Number.isFinite(current) ? current : safeTarget)

      if (progress < 1) {
        window.requestAnimationFrame(step)
      } else {
        setValue(safeTarget)
      }
    }

    const frameId = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(frameId)
  }, [safeTarget, safeDuration])

  return Number.isFinite(value) ? value : 0
}

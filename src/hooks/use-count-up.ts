import { useEffect, useState } from 'react'

export function useCountUp(target: number, durationMs = 600): number {
  const [value, setValue] = useState(0)

  useEffect(() => {
    let startTimestamp: number | null = null
    const startValue = 0

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp
      const progress = Math.min((timestamp - startTimestamp) / durationMs, 1)
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3)
      setValue(startValue + (target - startValue) * ease)

      if (progress < 1) {
        window.requestAnimationFrame(step)
      } else {
        setValue(target)
      }
    }

    const frameId = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(frameId)
  }, [target, durationMs])

  return value
}

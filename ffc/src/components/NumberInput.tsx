import { useEffect, useState } from 'react'

interface NumberInputProps {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  className?: string
  ariaLabel?: string
  disabled?: boolean
  stepper?: boolean // reserved for Scorer Picker follow-up
}

const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(n, min), max)

export function NumberInput({
  value,
  onChange,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  className,
  ariaLabel,
  disabled,
}: NumberInputProps) {
  const [displayValue, setDisplayValue] = useState(() => String(value))
  const [isFocused, setIsFocused] = useState(false)

  useEffect(() => {
    if (!isFocused) setDisplayValue(String(value))
  }, [value, isFocused])

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      className={className}
      aria-label={ariaLabel}
      disabled={disabled}
      value={displayValue}
      onChange={(e) => {
        const next = e.target.value
        if (next === '' || /^\d+$/.test(next)) {
          setDisplayValue(next)
          if (next !== '') {
            const parsed = Number(next)
            if (Number.isFinite(parsed)) onChange(clamp(parsed, min, max))
          }
        }
      }}
      onFocus={() => setIsFocused(true)}
      onBlur={() => {
        setIsFocused(false)
        if (displayValue === '' || Number.isNaN(Number(displayValue))) {
          setDisplayValue(String(min))
          onChange(min)
          return
        }
        const parsed = Number(displayValue)
        const clamped = clamp(parsed, min, max)
        if (clamped !== parsed) {
          setDisplayValue(String(clamped))
          onChange(clamped)
        }
      }}
    />
  )
}


import { useLayoutEffect, useRef } from 'react'
import { cn } from './cn'
import { fitTextarea } from '../../../lib/fit-textarea'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  onSubmit?: () => void
  maxHeight?: number
  autoFocus?: boolean
  className?: string
}

// Auto-grow textarea — grow logic ported from PromptInput.tsx:46-51.
export function PromptField({ value, onChange, placeholder, onSubmit, maxHeight = 220, autoFocus, className }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Measured off-page and written only on a real change (GH #139), so a key
  // within a line does not lay out the Create page around the field.
  useLayoutEffect(() => {
    if (ref.current) fitTextarea(ref.current, maxHeight)
  }, [value, maxHeight])

  return (
    <textarea
      ref={ref}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (onSubmit && (e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onSubmit() }
      }}
      placeholder={placeholder}
      rows={1}
      className={cn(
        // `lu-fokus-am-kasten`: beide Einbindungen sitzen in einem Kasten
        // mit `focus-within:border-*` (Composer.tsx), der den Fokus schon
        // zeichnet. Die Begruendung steht an der Regel in index.css.
        'lu-fokus-am-kasten t-body w-full resize-none bg-transparent outline-none text-gray-100 placeholder-gray-600 scrollbar-thin leading-relaxed',
        className,
      )}
      style={{ maxHeight }}
    />
  )
}
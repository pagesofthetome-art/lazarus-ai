import { useMemo, useState } from 'react'
import { Code2, ShieldCheck } from 'lucide-react'
import { buildDocument, type Viewport } from '../../lib/html-preview'
import { HtmlPreviewFrame, ViewportSwitcher } from './HtmlPreviewFrame'

interface Props {
  path: string
  content: string
}

/**
 * A visual preview of the exact staged HTML/SVG revision. Scripts stay off
 * until the user explicitly enables them for this preview.
 */
export function StagedHtmlPreview({ path, content }: Props) {
  const [viewport, setViewport] = useState<Viewport>('desktop')
  const [allowScripts, setAllowScripts] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  const language = extension === 'svg' ? 'svg' : 'html'
  const doc = useMemo(() => buildDocument(content, language), [content, language])

  return (
    <div className="border-t border-gray-100 dark:border-white/[0.04] p-1.5 space-y-1.5">
      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1 text-[0.5rem] text-gray-500 dark:text-gray-400">
          <ShieldCheck size={10} />
          Sandboxed preview · staged version
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAllowScripts((value) => !value)}
            className={`flex items-center gap-1 px-1 py-0.5 rounded text-[0.5rem] transition-colors ${allowScripts
              ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300'
              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10'
              }`}
            aria-pressed={allowScripts}
            title={allowScripts ? 'Turn off scripts in this preview' : 'Allow scripts in this preview'}
          >
            <Code2 size={9} />
            {allowScripts ? 'Scripts on' : 'Scripts off'}
          </button>
          <ViewportSwitcher viewport={viewport} onChange={setViewport} compact />
        </div>
      </div>
      <div className="h-[220px] w-full overflow-auto flex justify-center bg-gray-100 dark:bg-black/30 rounded">
        <HtmlPreviewFrame
          doc={doc}
          viewport={viewport}
          allowScripts={allowScripts}
          reloadKey={reloadKey}
          title={`Staged preview: ${path}`}
        />
      </div>
      <p className="text-[0.48rem] text-gray-500 dark:text-gray-400">
        Preview uses this file only. Separate CSS, JavaScript, and image files are not bundled here.
      </p>
      <button
        type="button"
        onClick={() => setReloadKey((value) => value + 1)}
        className="text-[0.5rem] text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
      >
        Reload preview
      </button>
    </div>
  )
}

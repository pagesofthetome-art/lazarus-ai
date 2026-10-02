import { Plug, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PLUGIN_CATALOG, PLUGIN_CATEGORIES } from '../../api/plugins/catalog'

type PluginCatalogMenuProps = {
  active: boolean
  onOpenCatalog: (detail?: { query?: string; categoryId?: string }) => void
  className: string
}

/** Compact header entry point for the complete plugin catalog. */
export function PluginCatalogMenu({ active, onOpenCatalog, className }: PluginCatalogMenuProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return []
    return PLUGIN_CATALOG.filter((plugin) => `${plugin.name} ${plugin.description}`.toLowerCase().includes(term)).slice(0, 6)
  }, [query])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  const openCatalog = (detail?: { query?: string; categoryId?: string }) => {
    setOpen(false)
    onOpenCatalog(detail)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-label="Plugins"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-current={active ? 'page' : undefined}
        className={className}
      >
        <Plug size={11} />
        <span>Plugins</span>
      </button>
      {open && (
        <div role="menu" aria-label="Plugin catalog" className="absolute left-1/2 top-full z-50 mt-2 max-h-[calc(100dvh-5.5rem)] w-80 -translate-x-1/2 overflow-y-auto scrollbar-thin rounded-xl border border-purple-300/25 bg-[#16121d] p-2 shadow-[0_0_32px_rgba(168,85,247,0.24)]">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-purple-300/60" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') openCatalog({ query }) }}
              placeholder="Search plugins by name or keyword"
              aria-label="Search plugins by name or keyword"
              className="w-full rounded-lg border border-purple-300/15 bg-black/25 py-1.5 pl-8 pr-2 text-xs text-gray-200 outline-none placeholder:text-gray-500 focus:border-purple-300/45"
            />
          </div>
          {matches.length > 0 && (
            <div className="mt-2 border-b border-white/[0.08] pb-2">
              {matches.map((plugin) => (
                <button key={plugin.id} role="menuitem" onClick={() => openCatalog({ query: plugin.name })} className="w-full rounded-md px-2 py-1.5 text-left text-xs text-gray-300 hover:bg-purple-500/15 hover:text-white">
                  <span className="block font-medium">{plugin.name}</span>
                  <span className="block truncate text-[0.62rem] text-gray-500">{plugin.description}</span>
                </button>
              ))}
            </div>
          )}
          <p className="px-1 pb-1 pt-1.5 text-[0.6rem] uppercase tracking-wider text-purple-200/60">Browse by function</p>
          <div className="grid grid-cols-2 gap-0.5">
            {PLUGIN_CATEGORIES.map((category) => (
              <button key={category.id} role="menuitem" onClick={() => openCatalog({ categoryId: category.id })} className="rounded-md px-2 py-1.5 text-left text-[0.66rem] text-gray-300 hover:bg-purple-500/15 hover:text-purple-100">
                <span className="block font-medium">{category.label}</span>
                <span className="mt-0.5 block line-clamp-2 text-[0.56rem] leading-snug text-gray-500">{category.description}</span>
              </button>
            ))}
          </div>
          <button role="menuitem" onClick={() => openCatalog()} className="mt-2 w-full rounded-md border border-purple-300/20 px-2 py-1.5 text-center text-[0.68rem] text-purple-200 hover:bg-purple-500/15">View all plugins</button>
        </div>
      )}
    </div>
  )
}

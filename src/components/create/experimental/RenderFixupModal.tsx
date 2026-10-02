import { Download } from 'lucide-react'
import { useCreateStore } from '../../../stores/createStore'
import { Modal } from '../../ui/Modal'

/**
 * Discord 2026-09-28: a model that needs a text encoder / VAE that is not on
 * disk, or a newer ComfyUI, gets the fix offered right here instead of a
 * sentence pointing at the Model Manager. Same pattern as VhsInstallModal:
 * useCreate sets `fixupPrompt`, this resolves it.
 */
export function RenderFixupModal() {
  const prompt = useCreateStore((s) => s.fixupPrompt)
  const choose = (go: boolean) => prompt?.resolve(go)
  return (
    <Modal open={prompt !== null} onClose={() => choose(false)} title={prompt?.title ?? ''}>
      <div className="space-y-4 text-sm text-gray-200">
        <p className="text-[12px] text-gray-300 leading-relaxed">{prompt?.detail}</p>
        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={() => choose(true)}
            className="w-full px-4 py-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 text-blue-200 text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <Download size={14} />
            {prompt?.confirm}
          </button>
          <button
            onClick={() => choose(false)}
            className="w-full px-4 py-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-gray-300 text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}

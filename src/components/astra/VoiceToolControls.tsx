import { useStore } from 'zustand'
import type { VoiceLoopStore } from '../../stores/voiceLoopStore'

export function VoiceToolControls({ store, answer, stop }: {
  store: VoiceLoopStore
  answer: (approved: boolean) => void
  stop: () => void
}) {
  const state = useStore(store)
  return <section aria-label="Voice tool controls">
    <p role="status">{state.error ?? (state.currentTool ? `Tool: ${state.currentTool}` : `Voice session: ${state.status}`)}</p>
    {state.pendingApproval && <div role="group" aria-label="Approve voice tool">
      <p>Allow {state.pendingApproval.name} for this call?</p>
      <pre tabIndex={0} style={{ maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {JSON.stringify(state.pendingApproval.args, null, 2)}
      </pre>
      <button type="button" onClick={() => answer(true)}>Allow this call</button>
      <button type="button" onClick={() => answer(false)}>Deny</button>
    </div>}
    <button type="button" onClick={stop} disabled={state.status === 'stopped' || state.status === 'idle'}>Stop voice tools</button>
  </section>
}

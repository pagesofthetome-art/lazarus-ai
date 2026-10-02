import { useEffect, useMemo, useRef } from 'react'
import { PipecatClientProvider, usePipecatClient } from '@pipecat-ai/client-react'
import type { PipecatClient } from '@pipecat-ai/client-js'
import { VoiceToolBridge } from '../../api/voice-tool-bridge'
import type { VoiceToolBridgeOptions } from '../../api/voice-tool-bridge'
import { createVoiceLoopStore } from '../../stores/voiceLoopStore'
import type { VoiceLoopState } from '../../stores/voiceLoopStore'
import { VoiceToolControls } from './VoiceToolControls'

type Options = Omit<VoiceToolBridgeOptions, 'client' | 'store'>

function BoundTools({ options, profile }: { options: Options; profile: VoiceLoopState['profile'] }) {
  const client = usePipecatClient()
  const store = useMemo(() => createVoiceLoopStore(profile, 'assistant'), [profile])
  const bridge = useRef<VoiceToolBridge | null>(null)
  useEffect(() => {
    if (!client) return
    const session = new VoiceToolBridge({ ...options, client, store })
    bridge.current = session
    return () => { session.stop(); bridge.current = null }
  }, [client, options, store])
  return <VoiceToolControls store={store} answer={(value) => bridge.current?.answer(value)} stop={() => {
    bridge.current?.stop()
    void client?.disconnect().catch(() => store.setState({ error: 'Voice connection cleanup failed. Tools are stopped.' }))
  }} />
}

// The caller supplies an authenticated transport and a stable per-run options
// object. Mount once per session. There is no provider credential in this UI.
export function VoiceToolSession({ client, options, profile }: {
  client: PipecatClient; options: Options; profile: VoiceLoopState['profile']
}) {
  return <PipecatClientProvider client={client}>
    <BoundTools key={options.run.token} options={options} profile={profile} />
  </PipecatClientProvider>
}

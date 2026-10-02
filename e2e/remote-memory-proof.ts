import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemorySettings } from '../src/components/settings/MemorySettings'
import { useMemoryStore, __setMemoryEmbedFn } from '../src/stores/memoryStore'
import { useRemoteStore } from '../src/stores/remoteStore'
import { useRemoteRecovery } from '../src/hooks/useRemoteRecovery'
import '../src/index.css'

await useMemoryStore.persist.rehydrate()
__setMemoryEmbedFn(async () => [])
function RemoteRecoveryProof() {
  useRemoteRecovery()
  return createElement(MemorySettings)
}
createRoot(document.getElementById('root')!).render(createElement(RemoteRecoveryProof))
useRemoteStore.subscribe(state => {
  document.getElementById('remote-state')!.textContent = JSON.stringify({ enabled: state.enabled, qrVisible: state.qrVisible })
})
document.getElementById('start')!.onclick = () => {
  void useRemoteStore.getState().startServer().catch(() => { /* Store renders the error. */ })
}
document.getElementById('stop')!.onclick = async () => {
  await useRemoteStore.getState().stopServer()
  document.getElementById('stop-result')!.textContent = 'Stop completed'
}

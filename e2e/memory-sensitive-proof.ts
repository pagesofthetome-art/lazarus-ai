import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemorySettings } from '../src/components/settings/MemorySettings'
import { useMemoryStore, __setMemoryEmbedFn } from '../src/stores/memoryStore'
import { useChatStore } from '../src/stores/chatStore'
import '../src/index.css'

await useMemoryStore.persist.rehydrate()
await useChatStore.persist.rehydrate()
__setMemoryEmbedFn(async () => [])
createRoot(document.getElementById('root')!).render(createElement(MemorySettings))
document.getElementById('retrieve')!.addEventListener('click', async () => {
  document.getElementById('result')!.textContent =
    await useMemoryStore.getState().getMemoriesForPromptAsync('private', 8192, {
      scope: useChatStore.getState().getActiveConversation()?.memoryScope,
    }) || 'No eligible memories'
})
const create = document.createElement('button')
create.textContent = 'Create proof conversation'
create.onclick = () => { useChatStore.getState().createConversation('', '') }
document.body.append(create)

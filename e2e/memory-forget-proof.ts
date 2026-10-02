import { useMemoryStore, __setMemoryEmbedFn } from '../src/stores/memoryStore'
import { exportAll } from '../src/lib/memoryEmbedDB'

let id = ''
let finish: ((value: number[][]) => void) | undefined
const status = document.querySelector('#status')!
document.querySelector('#start')!.addEventListener('click', async () => {
  await useMemoryStore.persist.rehydrate()
  useMemoryStore.getState().clearAll()
  __setMemoryEmbedFn(() => new Promise(resolve => {
    finish = resolve
    status.textContent = 'Embedding pending'
  }))
  id = useMemoryStore.getState().addMemory({
    type: 'user', title: 'Test preference', description: 'Synthetic fixture',
    content: 'Synthetic memory to forget', tags: [], source: 'chat',
  })
})
document.querySelector('#forget')!.addEventListener('click', () => {
  useMemoryStore.getState().removeMemory(id)
  status.textContent = 'Memory forgotten'
})
document.querySelector('#finish')!.addEventListener('click', async () => {
  finish?.([[1, 0]])
  // Drain the completed embedding and its IndexedDB transaction before reading.
  await new Promise(resolve => setTimeout(resolve, 100))
  const vectors = await exportAll()
  status.textContent = JSON.stringify({
    entries: useMemoryStore.getState().entries.length,
    vectors: Object.keys(vectors).length,
  })
})

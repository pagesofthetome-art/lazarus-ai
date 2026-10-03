/** Release notes included in this Lazarus build. */
export type ReleaseNoteItem = string | { title?: string; detail: string }

export function itemDetail(item: ReleaseNoteItem): string {
  return typeof item === 'string' ? item : item.detail
}

export function itemTitle(item: ReleaseNoteItem): string {
  return typeof item === 'string' ? item : (item.title ?? item.detail)
}

export interface ReleaseNoteSection {
  title: string
  items: ReleaseNoteItem[]
}

export interface ReleaseNote {
  version: string
  headline: string
  lines: ReleaseNoteItem[]
  details?: ReleaseNoteSection[]
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '3.0.5',
    headline: 'A more reliable catalog and smoother update path.',
    lines: [
      'Model recommendations now stay aligned with Lazarus tasks and the current hardware fit indicator.',
      'Long multilingual speech is split into safe chunks, and startup updates remain dismissible.',
      'Memory, tool calling, and model backups handle session and provider changes more reliably.',
    ],
  },
  {
    version: '3.0.4',
    headline: 'A clearer model catalog and safer updates at startup.',
    lines: [
      'Model cards now give clearer task recommendations, capability filters, and fit guidance based on the current computer.',
      'Lazarus checks for updates once when it opens and asks before downloading or installing one.',
    ],
  },
  {
    version: '3.0.3',
    headline: 'A hotfix: chats with many images no longer run the app out of memory, Create reads a model\'s family from the file, and the five bugs reported on GitHub since 3.0.2 are fixed.',
    lines: [
      {
        title: 'Chats with many images no longer run the app out of memory.',
        detail: 'Every image was kept inline in the saved chat history, and a few chats with phone photos were enough to make that history too big for the app\'s memory. On Windows it could not be saved at all once it passed 127 MiB. Images are now stored as separate files outside the history, and your history is moved over once, on the first start of this version. Chats and messages that only the app\'s backup file still held are restored from it once.',
      },
      {
        title: 'Create reads a model\'s family from the file, not from its name.',
        detail: 'Renders failed with "Value not in list" for models whose file name did not say what they are, which on CivitAI is most of them. Create now reads the family from the file header and loads the model from the folder it sits in, with pipelines of its own for Chroma, HiDream I1, SD 3.5, Lumina 2, Qwen-Image and Qwen-Image-Edit. If a text encoder or VAE is missing, or ComfyUI on this machine is too old, Create asks once, then downloads the file or updates ComfyUI.',
      },
      {
        title: 'Stop works in the Code tab again, also in the /loop bar.',
        detail: 'Both Stop buttons in the Code tab stopped nothing (issue 140): they passed the click event where the stop function expected a conversation. The one next to the prompt box and the one in the blue /loop bar both stop the run again.',
      },
      {
        title: 'Typing in the prompt box no longer lags in long chats.',
        detail: 'Each key made the page lay out the whole visible chat twice to size the box, so the delay grew with the conversation (issue 139). The box is now measured on a hidden copy and resized only when a line is added or removed.',
      },
      {
        title: '"Full body" in a chat image now shows the whole figure.',
        detail: 'The chat\'s image tool rendered every picture in the model\'s square default, and SDXL, Pony and Illustrious models crop a whole person in a square frame to the face (issue 142). When the prompt asks for a whole figure and names no size, the picture now gets the upright frame those models were trained on.',
      },
    ],
    details: [
      {
        title: 'Create',
        items: [
          {
            title: 'Edit keeps your photo at full strength.',
            detail: 'At strength 1.00, Edit dropped the source image without a word and painted a new picture from the prompt alone. It always keeps the source now, and the slider stops at 0.95, the strongest repaint that still starts from your photo.',
          },
          {
            title: 'A gallery picture can be dragged into Edit.',
            detail: 'Dragging a picture from the gallery onto the Edit drop zone did nothing. It now loads the picture, as a click already did.',
          },
          {
            title: 'Deleting a render in the gallery removes its file too.',
            detail: 'Deleting a local render, also from the large view, now moves its file to the Recycle Bin (Windows) or the Trash (Linux), so the ComfyUI output folder stops growing. Before, only the gallery entry went.',
          },
          {
            title: 'Gallery tiles come back when ComfyUI does.',
            detail: 'Tiles that went dark while ComfyUI was not answering come back as soon as it answers. They used to stay dark until the next start.',
          },
          {
            title: 'A bare VAE or text encoder is no longer offered as a model.',
            detail: 'A VAE or text encoder file that sits in a model folder no longer shows up in the model picker, where it could never run.',
          },
          {
            title: 'Downloads work with a ComfyUI on another machine.',
            detail: 'With ComfyUI running on another computer, model downloads failed with "permission denied" or "ComfyUI path not set" (issue 143). They now go to the Model Storage folder, in ComfyUI\'s own folder layout, and the Model Manager and Create say what is left to do on that machine: copy the folders over or share them, and install any node packs a bundle needs there.',
          },
        ],
      },
      {
        title: 'Chat and Code',
        items: [
          {
            title: 'The agent shows which folder it works in, and how to reach your files.',
            detail: 'Setting every agent permission to Auto never let the agent open files outside the chat\'s working folder, and a dismissed folder dialog left it in its own sandbox without a sign. The button next to Agent now always shows where the agent works, Sandbox included, and one click leads to "Pick a folder…". A file refused for being outside that folder brings up a line above the chat that says what to do, and Settings no longer says Filesystem reaches files anywhere. Plain chat has no tool that reads your files, so asking it for one now brings up a line that says to turn on Agent.',
          },
          {
            title: 'A /loop pass that ends early no longer leaves the loop running.',
            detail: 'A loop pass that ended before it could arm the next one left the bar on "running" and the working folder locked. The loop now ends with it.',
          },
          {
            title: 'A step too large for the server\'s context is shortened and sent again.',
            detail: 'When a server refuses a step because the request exceeds its context size, the step is sent again with the history shortened to fit, and the pass goes on. Later steps start at that size.',
          },
          {
            title: 'The recent list in the collapsed sidebar follows the mode.',
            detail: 'With Code or Remote picked in the collapsed sidebar, the recent list showed the plain chats (issue 141). It now lists that mode\'s chats, and opening one stays in that mode.',
          },
          {
            title: 'Image previews in a long chat load only near where you are reading.',
            detail: 'In a long chat, image previews load only near the part you are looking at, so scrolling through many images keeps memory low.',
          },
        ],
      },
    ],
  }
]

export function releaseNoteFor(version: string): ReleaseNote | undefined {
  return RELEASE_NOTES.find((note) => note.version === version)
}

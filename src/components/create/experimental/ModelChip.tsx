import { useCreateStore } from '../../../stores/createStore'
import { Select, type SelectOption } from '../ui/Select'
import { TYPE_BADGE } from './badges'
import { resolveLocalOpPick, videoLaneModels } from '../../../api/comfyui'

export function ModelChip() {
  return <LocalModelChip />
}
function LocalModelChip() {
  const mode = useCreateStore((s) => s.mode)
  const intent = useCreateStore((s) => s.intent())
  const imageModel = useCreateStore((s) => s.imageModel)
  const videoModel = useCreateStore((s) => s.videoModel)
  const localOpModel = useCreateStore((s) => s.localOpModel)
  const imageModelList = useCreateStore((s) => s.imageModelList)
  const videoModelList = useCreateStore((s) => s.videoModelList)
  const audioModelList = useCreateStore((s) => s.audioModelList)
  const lipsyncModelList = useCreateStore((s) => s.lipsyncModelList)
  const motionModelList = useCreateStore((s) => s.motionModelList)
  const setImageModel = useCreateStore((s) => s.setImageModel)
  const setVideoModel = useCreateStore((s) => s.setVideoModel)
  const setLocalOpModel = useCreateStore((s) => s.setLocalOpModel)

  const isVideo = mode === 'video'
  // The 2.5.8 lanes with their own local model families. Extend is NOT here:
  // it rides the regular i2v-capable video list (last-frame continue).
  const laneList =
    intent === 'music' ? audioModelList
    : intent === 'lipsync' ? lipsyncModelList
    : intent === 'motion' ? motionModelList
    : null

  // Mirror the cloud picker's op-gating (David 2026-07-17: "only offer models
  // that can actually do it"): Animate/Extend list i2v-capable local models,
  // Video lists t2v-capable ones (SVD/FramePack are i2v-only and drop there).
  // Shared with Stage's missing-models gate so card and picker cannot drift.
  const rawList = isVideo ? videoModelList : imageModelList
  const list = laneList ?? (!isVideo ? rawList : videoLaneModels(rawList, intent))
  const stored = laneList ? localOpModel : (isVideo ? videoModel : imageModel)
  // Reflect the model the run will really use — a leftover pick the current
  // op can't perform must not show as "selected". Lanes share the submit-side
  // rule (resolveLocalOpPick) so chip, meter and run always agree.
  const value = laneList
    ? resolveLocalOpPick(stored, list)
    : list.some((m) => m.name === stored) ? stored : (list[0]?.name ?? stored)

  const options: SelectOption[] = list.map((m) => ({
    value: m.name,
    label: prettyName(m.name),
    badge: TYPE_BADGE[m.type],
  }))
  return (
    <Select
      size="sm"
      searchable
      align="right"
      className="min-w-[150px] max-w-[230px]"
      options={options}
      value={value}
      onChange={(v) => {
        if (laneList) setLocalOpModel(v)
        else if (isVideo) setVideoModel(v)
        else {
          const m = list.find((x) => x.name === v)
          setImageModel(v, m?.type ?? 'unknown')
        }
      }}
    />
  )
}

function prettyName(filename: string): string {
  return filename.replace(/\.(safetensors|ckpt|pt|gguf)$/i, '').replace(/[_]+/g, ' ')
}

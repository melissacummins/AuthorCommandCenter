// Curated set of Fal.AI models exposed in the Media generator.
//
// `isFeatured: true` keeps a model in the default dropdown; everything
// else is hidden behind "Show all models" so the picker stays tight by
// default. Users can also add their own custom endpoints from the UI
// for anything we don't ship — see media_custom_models.
//
// Costs are rough estimates Fal updates occasionally — treat them as a
// guardrail for the spend cap, not an invoice.

export type MediaKind = 'image' | 'video';

export interface ModelDef {
  id: string;
  label: string;
  kind: MediaKind;
  endpoint: string;
  acceptsInputImage: boolean;
  // Optional image-editing endpoint. When set, this is a generation
  // model that ALSO accepts reference images — attaching one routes the
  // request to this endpoint (like ChatGPT). When unset and
  // acceptsInputImage is true, `endpoint` is itself an edit endpoint.
  editEndpoint?: string;
  // Cost per output image when routing to editEndpoint. Edit endpoints
  // are typically pricier than text-to-image (they tokenize the input
  // image too). When unset, falls back to estimatedCostCents.
  editCostCents?: number;
  supportsCustomSize: boolean;
  description: string;
  estimatedCostCents: number;
  isAsync: boolean;
  isFeatured: boolean;
  group: 'image' | 'image-edit' | 'image-upscale' | 'video';
}

// A model can take reference images if its base endpoint is an editor
// (acceptsInputImage) or it has a dedicated editEndpoint to route to.
export function supportsReferenceImages(m: { acceptsInputImage: boolean; editEndpoint?: string }): boolean {
  return m.acceptsInputImage || !!m.editEndpoint;
}

// GPT Image 1 pricing depends on a `quality` parameter that Fal/OpenAI
// charge for very differently — low is ~10× cheaper than high. Estimates
// include a small markup over OpenAI's published rates and (for edit)
// the cost of one input image's tokens. Real cost also scales with
// output size, so treat these as worst-case-for-1024 guardrails.
export type GptImage1Quality = 'low' | 'medium' | 'high' | 'auto';

// Via Fal — includes Fal's markup over OpenAI's pass-through rate.
// Numbers bumped from v1 to reflect gpt-image-2's higher per-token
// output rate. Fal silently routes `quality: auto` to `high`.
const GPT_IMAGE_1_GENERATE_CENTS: Record<GptImage1Quality, number> = {
  low: 3, medium: 10, high: 25, auto: 25,
};
const GPT_IMAGE_1_EDIT_CENTS: Record<GptImage1Quality, number> = {
  low: 12, medium: 30, high: 45, auto: 45,
};
// Via OpenAI direct — no markup. Source: OpenAI gpt-image-2 pricing
// (per output @ 1024×1024): low ~$0.006 / medium ~$0.053 / high ~$0.211.
// Edits add an input-image token cost (~$0.02–0.03).
const GPT_IMAGE_1_OPENAI_GENERATE_CENTS: Record<GptImage1Quality, number> = {
  low: 1, medium: 6, high: 22, auto: 22,
};
const GPT_IMAGE_1_OPENAI_EDIT_CENTS: Record<GptImage1Quality, number> = {
  low: 3, medium: 9, high: 25, auto: 25,
};

export type GptImage1Provider = 'fal' | 'openai';

export function gptImage1CostCents(
  quality: GptImage1Quality,
  isEdit: boolean,
  provider: GptImage1Provider = 'fal',
): number {
  if (provider === 'openai') {
    const t = isEdit ? GPT_IMAGE_1_OPENAI_EDIT_CENTS : GPT_IMAGE_1_OPENAI_GENERATE_CENTS;
    return t[quality] ?? t.auto;
  }
  const t = isEdit ? GPT_IMAGE_1_EDIT_CENTS : GPT_IMAGE_1_GENERATE_CENTS;
  return t[quality] ?? t.auto;
}

export const MODELS: ModelDef[] = [
  // ============================================
  // FEATURED — image generation
  // ============================================
  {
    id: 'nano-banana',
    label: 'Nano Banana — generate',
    kind: 'image',
    endpoint: 'fal-ai/nano-banana',
    acceptsInputImage: false,
    editEndpoint: 'fal-ai/nano-banana/edit',
    supportsCustomSize: true,
    description: "Google's Gemini image model. Great all-rounder; attach a reference image to edit.",
    estimatedCostCents: 4,
    isAsync: false,
    isFeatured: true,
    group: 'image',
  },
  {
    id: 'flux-pro-v11',
    label: 'Flux Pro v1.1',
    kind: 'image',
    endpoint: 'fal-ai/flux-pro/v1.1',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: "Flux's flagship — highest fidelity in the family. A good upgrade over Dev for finished assets.",
    estimatedCostCents: 5,
    isAsync: false,
    isFeatured: true,
    group: 'image',
  },
  {
    id: 'flux-schnell',
    label: 'Flux Schnell (fast)',
    kind: 'image',
    endpoint: 'fal-ai/flux/schnell',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: 'Cheapest, fastest Flux. Great for drafts and iteration.',
    estimatedCostCents: 1,
    isAsync: false,
    isFeatured: true,
    group: 'image',
  },
  {
    id: 'ideogram-v3',
    label: 'Ideogram v3',
    kind: 'image',
    endpoint: 'fal-ai/ideogram/v3',
    acceptsInputImage: false,
    editEndpoint: 'fal-ai/ideogram/v3/edit',
    supportsCustomSize: true,
    description: 'Best-in-class for text inside images — ideal for Pinterest pins. Attach a reference to edit.',
    estimatedCostCents: 6,
    isAsync: false,
    isFeatured: true,
    group: 'image',
  },
  {
    id: 'imagen4',
    label: 'Imagen 4',
    kind: 'image',
    endpoint: 'fal-ai/imagen4/preview',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: "Google Imagen 4 — strong photorealism and prompt adherence.",
    estimatedCostCents: 5,
    isAsync: false,
    isFeatured: true,
    group: 'image',
  },
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2 (ChatGPT)',
    kind: 'image',
    endpoint: 'openai/gpt-image-2',
    acceptsInputImage: false,
    editEndpoint: 'openai/gpt-image-2/edit',
    editCostCents: 45,
    supportsCustomSize: true,
    description: "OpenAI's flagship image model — same one ChatGPT uses now. Cost scales with the Quality setting (Low ~$0.12 → High ~$0.45 for edits, Auto defaults to High).",
    estimatedCostCents: 25,
    isAsync: false,
    isFeatured: true,
    group: 'image',
  },
  {
    id: 'recraft-v3',
    label: 'Recraft v3',
    kind: 'image',
    endpoint: 'fal-ai/recraft-v3',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: 'Vector-leaning model. Good for clean graphic / poster styles.',
    estimatedCostCents: 5,
    isAsync: false,
    isFeatured: true,
    group: 'image',
  },

  // ============================================
  // FEATURED — image editing
  // ============================================
  {
    id: 'nano-banana-edit',
    label: 'Nano Banana — edit image',
    kind: 'image',
    endpoint: 'fal-ai/nano-banana/edit',
    acceptsInputImage: true,
    supportsCustomSize: false,
    description: 'Edit an existing image with a text prompt.',
    estimatedCostCents: 4,
    isAsync: false,
    isFeatured: true,
    group: 'image-edit',
  },
  {
    id: 'flux-kontext',
    label: 'Flux Pro Kontext (edit)',
    kind: 'image',
    endpoint: 'fal-ai/flux-pro/kontext',
    acceptsInputImage: true,
    supportsCustomSize: false,
    description: 'Image editing that preserves identity and structure better than vanilla edit models.',
    estimatedCostCents: 6,
    isAsync: false,
    isFeatured: true,
    group: 'image-edit',
  },

  // ============================================
  // FEATURED — video
  // ============================================
  {
    id: 'kling-video',
    label: 'Kling v2 — text to video',
    kind: 'video',
    endpoint: 'fal-ai/kling-video/v2/master/text-to-video',
    acceptsInputImage: false,
    supportsCustomSize: false,
    description: '5-second cinematic clips from a text prompt. ~60–90 seconds to render.',
    estimatedCostCents: 140,
    isAsync: true,
    isFeatured: true,
    group: 'video',
  },
  {
    id: 'kling-image-to-video',
    label: 'Kling v2 — image to video',
    kind: 'video',
    endpoint: 'fal-ai/kling-video/v2/master/image-to-video',
    acceptsInputImage: true,
    supportsCustomSize: false,
    description: 'Animate an uploaded image into a 5-second clip.',
    estimatedCostCents: 140,
    isAsync: true,
    isFeatured: true,
    group: 'video',
  },
  {
    id: 'veo3-fast',
    label: 'Veo 3 Fast',
    kind: 'video',
    endpoint: 'fal-ai/veo3/fast',
    acceptsInputImage: false,
    supportsCustomSize: false,
    description: "Google Veo 3, fast variant. Strong cinematic quality with audio.",
    estimatedCostCents: 200,
    isAsync: true,
    isFeatured: true,
    group: 'video',
  },
  {
    id: 'ltx-video',
    label: 'LTX Video (cheap)',
    kind: 'video',
    endpoint: 'fal-ai/ltx-video-13b-distilled',
    acceptsInputImage: false,
    supportsCustomSize: false,
    description: 'Fast open video model. Lower fidelity than Kling but much cheaper.',
    estimatedCostCents: 20,
    isAsync: true,
    isFeatured: true,
    group: 'video',
  },

  // ============================================
  // EXTENDED — image generation
  // ============================================
  {
    id: 'flux-dev',
    label: 'Flux Dev',
    kind: 'image',
    endpoint: 'fal-ai/flux/dev',
    acceptsInputImage: false,
    editEndpoint: 'fal-ai/flux/dev/image-to-image',
    supportsCustomSize: true,
    description: 'High-quality stylised image model. Attach a reference for image-to-image.',
    estimatedCostCents: 3,
    isAsync: false,
    isFeatured: false,
    group: 'image',
  },
  {
    id: 'flux-pro-ultra',
    label: 'Flux Pro v1.1 Ultra',
    kind: 'image',
    endpoint: 'fal-ai/flux-pro/v1.1-ultra',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: 'Ultra-high resolution Flux. Slower and more expensive than regular v1.1.',
    estimatedCostCents: 8,
    isAsync: false,
    isFeatured: false,
    group: 'image',
  },
  {
    id: 'flux-lora',
    label: 'Flux LoRA',
    kind: 'image',
    endpoint: 'fal-ai/flux-lora',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: 'Flux with optional LoRA weights for fine-tuned styles.',
    estimatedCostCents: 4,
    isAsync: false,
    isFeatured: false,
    group: 'image',
  },
  {
    id: 'imagen3',
    label: 'Imagen 3',
    kind: 'image',
    endpoint: 'fal-ai/imagen3',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: 'Previous-gen Google Imagen. Still solid and slightly cheaper than v4.',
    estimatedCostCents: 4,
    isAsync: false,
    isFeatured: false,
    group: 'image',
  },
  {
    id: 'ideogram-v2',
    label: 'Ideogram v2',
    kind: 'image',
    endpoint: 'fal-ai/ideogram/v2',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: 'Older Ideogram. Cheaper than v3 if you mostly want strong typography.',
    estimatedCostCents: 5,
    isAsync: false,
    isFeatured: false,
    group: 'image',
  },
  {
    id: 'ideogram-v2-turbo',
    label: 'Ideogram v2 Turbo',
    kind: 'image',
    endpoint: 'fal-ai/ideogram/v2-turbo',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: 'Faster, cheaper Ideogram v2 — for high-volume / draft work.',
    estimatedCostCents: 3,
    isAsync: false,
    isFeatured: false,
    group: 'image',
  },
  {
    id: 'sd35-large',
    label: 'Stable Diffusion 3.5 Large',
    kind: 'image',
    endpoint: 'fal-ai/stable-diffusion-v35-large',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: 'Stability AI flagship. Open weights, very flexible.',
    estimatedCostCents: 4,
    isAsync: false,
    isFeatured: false,
    group: 'image',
  },
  {
    id: 'sd35-medium',
    label: 'Stable Diffusion 3.5 Medium',
    kind: 'image',
    endpoint: 'fal-ai/stable-diffusion-v35-medium',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: 'Smaller, cheaper SD 3.5.',
    estimatedCostCents: 2,
    isAsync: false,
    isFeatured: false,
    group: 'image',
  },
  {
    id: 'sana',
    label: 'Sana',
    kind: 'image',
    endpoint: 'fal-ai/sana',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: 'NVIDIA Sana — efficient, very fast.',
    estimatedCostCents: 1,
    isAsync: false,
    isFeatured: false,
    group: 'image',
  },
  {
    id: 'bria-t2i',
    label: 'Bria — text to image',
    kind: 'image',
    endpoint: 'fal-ai/bria/text-to-image/base',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: 'Commercially safe Bria model — trained on licensed data.',
    estimatedCostCents: 4,
    isAsync: false,
    isFeatured: false,
    group: 'image',
  },
  {
    id: 'photon-1',
    label: 'Luma Photon',
    kind: 'image',
    endpoint: 'fal-ai/luma-photon',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: "Luma Labs Photon — strong aesthetic photo model.",
    estimatedCostCents: 4,
    isAsync: false,
    isFeatured: false,
    group: 'image',
  },
  {
    id: 'hidream',
    label: 'HiDream I1',
    kind: 'image',
    endpoint: 'fal-ai/hidream-i1-full',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: 'High-quality open image model.',
    estimatedCostCents: 4,
    isAsync: false,
    isFeatured: false,
    group: 'image',
  },
  {
    id: 'qwen-image',
    label: 'Qwen Image',
    kind: 'image',
    endpoint: 'fal-ai/qwen-image',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: 'Alibaba Qwen image model.',
    estimatedCostCents: 3,
    isAsync: false,
    isFeatured: false,
    group: 'image',
  },

  // ============================================
  // EXTENDED — image editing & utility
  // ============================================
  {
    id: 'ideogram-v3-edit',
    label: 'Ideogram v3 — edit',
    kind: 'image',
    endpoint: 'fal-ai/ideogram/v3/edit',
    acceptsInputImage: true,
    supportsCustomSize: false,
    description: 'Edit images while preserving Ideogram-grade text rendering.',
    estimatedCostCents: 6,
    isAsync: false,
    isFeatured: false,
    group: 'image-edit',
  },
  {
    id: 'flux-i2i',
    label: 'Flux Dev — image to image',
    kind: 'image',
    endpoint: 'fal-ai/flux/dev/image-to-image',
    acceptsInputImage: true,
    supportsCustomSize: true,
    description: 'Re-render an existing image in a different style.',
    estimatedCostCents: 3,
    isAsync: false,
    isFeatured: false,
    group: 'image-edit',
  },
  {
    id: 'bria-eraser',
    label: 'Bria — eraser',
    kind: 'image',
    endpoint: 'fal-ai/bria/eraser',
    acceptsInputImage: true,
    supportsCustomSize: false,
    description: 'Remove objects from an image cleanly.',
    estimatedCostCents: 4,
    isAsync: false,
    isFeatured: false,
    group: 'image-edit',
  },
  {
    id: 'birefnet-bg-remove',
    label: 'BiRefNet — remove background',
    kind: 'image',
    endpoint: 'fal-ai/birefnet',
    acceptsInputImage: true,
    supportsCustomSize: false,
    description: 'Clean background removal.',
    estimatedCostCents: 1,
    isAsync: false,
    isFeatured: false,
    group: 'image-edit',
  },
  {
    id: 'clarity-upscaler',
    label: 'Clarity Upscaler',
    kind: 'image',
    endpoint: 'fal-ai/clarity-upscaler',
    acceptsInputImage: true,
    supportsCustomSize: false,
    description: 'Upscale and sharpen an existing image.',
    estimatedCostCents: 3,
    isAsync: false,
    isFeatured: false,
    group: 'image-upscale',
  },
  {
    id: 'aura-sr',
    label: 'Aura SR — upscale',
    kind: 'image',
    endpoint: 'fal-ai/aura-sr',
    acceptsInputImage: true,
    supportsCustomSize: false,
    description: 'Super-resolution upscaling.',
    estimatedCostCents: 2,
    isAsync: false,
    isFeatured: false,
    group: 'image-upscale',
  },

  // ============================================
  // EXTENDED — video
  // ============================================
  {
    id: 'kling-v16-std',
    label: 'Kling v1.6 (standard)',
    kind: 'video',
    endpoint: 'fal-ai/kling-video/v1.6/standard/text-to-video',
    acceptsInputImage: false,
    supportsCustomSize: false,
    description: 'Previous-gen Kling. Cheaper than v2 with slightly lower fidelity.',
    estimatedCostCents: 35,
    isAsync: true,
    isFeatured: false,
    group: 'video',
  },
  {
    id: 'wan-t2v',
    label: 'Wan 2.2 — text to video',
    kind: 'video',
    endpoint: 'fal-ai/wan/v2.2-5b/text-to-video',
    acceptsInputImage: false,
    supportsCustomSize: false,
    description: 'Alibaba Wan 2.2 — strong cinematic open video model.',
    estimatedCostCents: 60,
    isAsync: true,
    isFeatured: false,
    group: 'video',
  },
  {
    id: 'wan-i2v',
    label: 'Wan 2.2 — image to video',
    kind: 'video',
    endpoint: 'fal-ai/wan/v2.2-5b/image-to-video',
    acceptsInputImage: true,
    supportsCustomSize: false,
    description: 'Wan 2.2 animating an input image.',
    estimatedCostCents: 60,
    isAsync: true,
    isFeatured: false,
    group: 'video',
  },
  {
    id: 'minimax-hailuo-02',
    label: 'Minimax Hailuo 02',
    kind: 'video',
    endpoint: 'fal-ai/minimax/hailuo-02',
    acceptsInputImage: false,
    supportsCustomSize: false,
    description: 'Minimax Hailuo 02 video. Distinct stylistic look.',
    estimatedCostCents: 80,
    isAsync: true,
    isFeatured: false,
    group: 'video',
  },
  {
    id: 'hunyuan-video',
    label: 'Hunyuan Video',
    kind: 'video',
    endpoint: 'fal-ai/hunyuan-video',
    acceptsInputImage: false,
    supportsCustomSize: false,
    description: 'Tencent Hunyuan video. Strong motion realism.',
    estimatedCostCents: 80,
    isAsync: true,
    isFeatured: false,
    group: 'video',
  },
];

export function findCuratedModel(id: string): ModelDef | undefined {
  return MODELS.find((m) => m.id === id);
}

// Back-compat for the previous import name used elsewhere.
export const findModel = findCuratedModel;

// Max images a model can produce in one request. Editing, upscaling and
// video endpoints return a single output; plain image generation
// supports batches. Used to cap the quantity selector in the UI.
export function maxImagesForGroup(kind: MediaKind, group: ModelDef['group']): number {
  if (kind === 'video') return 1;
  if (group === 'image-edit' || group === 'image-upscale') return 1;
  return 4;
}

export function maxImagesFor(m: ModelDef): number {
  return maxImagesForGroup(m.kind, m.group);
}

// Curated set of Fal.AI models exposed in the Media generator.
//
// Each model declares whether it generates images or video, whether it
// accepts an input image (for editing / image-to-image), the Fal
// endpoint to hit, and an estimated cost in cents per generation that
// we use for the in-app spend cap. Costs are rough — Fal updates them
// occasionally; treat them as a guardrail, not an invoice.

export type MediaKind = 'image' | 'video';

export interface ModelDef {
  id: string;
  label: string;
  kind: MediaKind;
  endpoint: string;
  acceptsInputImage: boolean;
  supportsCustomSize: boolean;
  description: string;
  estimatedCostCents: number;
  isAsync: boolean;
}

export const MODELS: ModelDef[] = [
  {
    id: 'nano-banana',
    label: 'Nano Banana — generate',
    kind: 'image',
    endpoint: 'fal-ai/nano-banana',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: "Google's Gemini image model. Great all-rounder, good prompt following.",
    estimatedCostCents: 4,
    isAsync: false,
  },
  {
    id: 'nano-banana-edit',
    label: 'Nano Banana — edit image',
    kind: 'image',
    endpoint: 'fal-ai/nano-banana/edit',
    acceptsInputImage: true,
    supportsCustomSize: false,
    description: 'Edit an existing image with a text prompt. Upload an image to use this.',
    estimatedCostCents: 4,
    isAsync: false,
  },
  {
    id: 'flux-dev',
    label: 'Flux Dev',
    kind: 'image',
    endpoint: 'fal-ai/flux/dev',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: 'High-quality stylised image model. Strong for artistic / moody pieces.',
    estimatedCostCents: 3,
    isAsync: false,
  },
  {
    id: 'ideogram-v3',
    label: 'Ideogram v3',
    kind: 'image',
    endpoint: 'fal-ai/ideogram/v3',
    acceptsInputImage: false,
    supportsCustomSize: true,
    description: 'Best-in-class for rendering text inside images — ideal for Pinterest pins with headlines.',
    estimatedCostCents: 6,
    isAsync: false,
  },
  {
    id: 'gpt-image-1',
    label: 'GPT Image 1 (ChatGPT)',
    kind: 'image',
    endpoint: 'fal-ai/gpt-image-1',
    acceptsInputImage: true,
    supportsCustomSize: true,
    description: "The same model that powers ChatGPT's image generation, via Fal. Excellent prompt adherence.",
    estimatedCostCents: 7,
    isAsync: false,
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
  },
  {
    id: 'kling-video',
    label: 'Kling — text to video',
    kind: 'video',
    endpoint: 'fal-ai/kling-video/v2/master/text-to-video',
    acceptsInputImage: false,
    supportsCustomSize: false,
    description: '5-second cinematic clips from a text prompt. Takes ~60-90 seconds.',
    estimatedCostCents: 140,
    isAsync: true,
  },
  {
    id: 'kling-image-to-video',
    label: 'Kling — image to video',
    kind: 'video',
    endpoint: 'fal-ai/kling-video/v2/master/image-to-video',
    acceptsInputImage: true,
    supportsCustomSize: false,
    description: 'Animate an uploaded image into a 5-second clip.',
    estimatedCostCents: 140,
    isAsync: true,
  },
  {
    id: 'ltx-video',
    label: 'LTX Video (fast)',
    kind: 'video',
    endpoint: 'fal-ai/ltx-video',
    acceptsInputImage: false,
    supportsCustomSize: false,
    description: 'Fast open video model. Lower fidelity than Kling but much cheaper and quicker.',
    estimatedCostCents: 20,
    isAsync: true,
  },
];

export function findModel(id: string): ModelDef | undefined {
  return MODELS.find((m) => m.id === id);
}

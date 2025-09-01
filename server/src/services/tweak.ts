export type TweakMode = 'off' | 'suggest' | 'auto';

export type TweakResult =
  | { action: 'allow'; text: string }
  | { action: 'suggest'; text: string; suggestion: string }
  | { action: 'rewrite'; text: string; note: string }
  | { action: 'block'; reason: string };

// Very lightweight heuristic. This is NOT a replacement for a full policy model.
// It catches obvious illegal requests and proposes safer rewrites when possible.
export function tweakUserText(input: string, mode: TweakMode): TweakResult {
  const text = input.trim();
  // Absolute block: sexual content involving minors
  const minorSexual = /(minor|under\s*age|child|teen)\s*(sex|sexual|porn|nsfw|explicit)/i;
  if (minorSexual.test(text)) {
    return { action: 'block', reason: 'Sexual content involving minors is prohibited.' };
  }

  // Suggest/rewrite for explicit planning of illegal harm
  const violentCrime = /(murder|kill|assassinate|bomb|terror|poison)\b/i;
  if (violentCrime.test(text)) {
    if (mode === 'auto') {
      const rewrite = text.replace(violentCrime, 'confront');
      return { action: 'rewrite', text: rewrite, note: 'Rewrote to remove explicit violent/illegal act.' };
    }
    if (mode === 'suggest') {
      return { action: 'suggest', text, suggestion: 'Consider reframing as a lawful conflict or investigation (e.g., “confront the villain” or “gather evidence”).' };
    }
  }

  // Suggest/rewrite for theft/drugs specifics
  const theft = /(steal|rob|break\s*in|burglary)\b/i;
  const drugs = /(make|sell|buy)\s+(meth|coke|cocaine|heroin|drugs)\b/i;
  if (theft.test(text) || drugs.test(text)) {
    if (mode === 'auto') {
      const rewrite = text
        .replace(theft, 'retrieve')
        .replace(drugs, 'acquire supplies');
      return { action: 'rewrite', text: rewrite, note: 'Rewrote to avoid explicit illegal activity.' };
    }
    if (mode === 'suggest') {
      return { action: 'suggest', text, suggestion: 'Try a lawful alternative (e.g., “retrieve the item via a trade or ruse”).' };
    }
  }

  return { action: 'allow', text };
}


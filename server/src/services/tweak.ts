export type TweakMode = 'off' | 'suggest' | 'auto';

export type TweakResult =
  | { action: 'allow'; text: string }
  | { action: 'suggest'; text: string; suggestion: string }
  | { action: 'rewrite'; text: string; note: string }
  | { action: 'block'; reason: string };

// Very lightweight heuristic. This is NOT a replacement for a full policy model.
// It catches obvious illegal requests and proposes safer rewrites when possible.
export function tweakUserText(input: string, mode: TweakMode, ctx?: { ages?: Record<string, number|null>, mature?: boolean }): TweakResult {
  const text = input.trim();
  // Absolute block: sexual content involving minors
  const minorSexual = /(minor|under\s*age|child|teen)\s*(sex|sexual|porn|nsfw|explicit)/i;
  if (minorSexual.test(text)) {
    return { action: 'block', reason: 'Sexual content involving minors is prohibited.' };
  }

  // If text implies sexual content, ensure ages are adult or known
  const sexual = /(sex|sexual|NSFW|erotic|intimate|make\s*love)\b/i;
  if (sexual.test(text)) {
    const ages = ctx?.ages || {};
    const values = Object.values(ages);
    const unknown = values.length === 0 || values.some(v => v == null);
    const underage = values.some(v => (v as any) !== null && Number(v) < 18);
    if (underage) return { action: 'block', reason: 'One or more characters are under 18.' };
    if (unknown) {
      if (mode === 'auto') {
        // Soft auto-tweak: annotate request to clarify adults-only
        return { action: 'rewrite', text: text + ' (Note: all characters are adults 18+.)', note: 'Assumed adult ages due to unspecified ages.' };
      }
      return { action: 'suggest', text, suggestion: 'Please specify character ages (18+) in profiles or your message so adult content is clearly constrained.' };
    }
  }

  // Allow crime as narrative, but block instructional detail for serious harm
  // Detect step-by-step or how-to for explosives / weapons / hard harm
  const howTo = /(how\s+to|step[-\s]*by[-\s]*step|recipe|materials\s+list|exact\s+amounts|wiring\s+diagram)/i;
  const serious = /(bomb|explosive|pipe\s*bomb|molotov|napalm|manufacture\s*gunpowder|3d\s*printed\s*gun|untraceable\s*weapon|poison|ricin|sarin)/i;
  if (serious.test(text) && howTo.test(text)) {
    if (mode === 'auto') {
      return { action: 'rewrite', text: text.replace(howTo, 'high-level'), note: 'Removed instructional detail for dangerous wrongdoing.' };
    }
    if (mode === 'suggest') {
      return { action: 'suggest', text, suggestion: 'We can include this as backstory or high-level narrative without step-by-step instructions.' };
    }
    return { action: 'allow', text };
  }

  // Theft allowed as narrative; no tweak needed by default

  return { action: 'allow', text };
}

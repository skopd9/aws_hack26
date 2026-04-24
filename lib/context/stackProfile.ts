import 'server-only';
import { z } from 'zod';
import { redis, safeRedisOp, stackProfileKey, TTL } from '../redis';

export const StackProfileSchema = z.object({
  tenant: z.string(),
  description: z.string().default(''),
  languages: z.array(z.string()).default([]),
  frameworks: z.array(z.string()).default([]),
  infrastructure: z.array(z.string()).default([]),
  aiComponents: z.array(z.string()).default([]),
  productAreas: z.array(z.string()).default([]),
  notes: z.string().default(''),
  updatedAt: z.number().default(() => Date.now())
});

export type StackProfile = z.infer<typeof StackProfileSchema>;

export async function getStackProfile(
  tenant: string
): Promise<StackProfile | null> {
  const raw = await safeRedisOp(
    () => redis.get(stackProfileKey(tenant)),
    null
  );
  if (!raw) return null;
  try {
    const parsed = StackProfileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function setStackProfile(profile: StackProfile): Promise<void> {
  const normalized = StackProfileSchema.parse({
    ...profile,
    updatedAt: Date.now()
  });
  await safeRedisOp(
    () =>
      redis.set(
        stackProfileKey(profile.tenant),
        JSON.stringify(normalized),
        'EX',
        TTL.stackProfile
      ),
    null
  );
}

export function renderStackProfile(profile: StackProfile | null): string {
  if (!profile) {
    return 'No stack profile on file yet. Ask the engineer to describe their stack before running patent searches.';
  }
  const lines: string[] = [];
  if (profile.description) lines.push(`Description: ${profile.description}`);
  if (profile.languages.length)
    lines.push(`Languages: ${profile.languages.join(', ')}`);
  if (profile.frameworks.length)
    lines.push(`Frameworks: ${profile.frameworks.join(', ')}`);
  if (profile.infrastructure.length)
    lines.push(`Infrastructure: ${profile.infrastructure.join(', ')}`);
  if (profile.aiComponents.length)
    lines.push(`AI components: ${profile.aiComponents.join(', ')}`);
  if (profile.productAreas.length)
    lines.push(`Product areas: ${profile.productAreas.join(', ')}`);
  if (profile.notes) lines.push(`Notes: ${profile.notes}`);
  return lines.join('\n');
}

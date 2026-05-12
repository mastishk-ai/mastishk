import { MskNodeSchema } from './schema.js';

export function validate(node: unknown): { valid: boolean; errors: string[] } {
  const result = MskNodeSchema.safeParse(node);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  const errors = result.error.errors.map(
    (e) => `${e.path.join('.') || '(root)'}: ${e.message}`
  );
  return { valid: false, errors };
}

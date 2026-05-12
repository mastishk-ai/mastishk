import { readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import { validate } from './validate.js';
import type { MskNode } from './schema.js';

export class MskReadError extends Error {
  readonly filePath: string;
  readonly validationErrors: string[];
  readonly rawContent: string;

  constructor(filePath: string, validationErrors: string[], rawContent: string) {
    super(`Invalid .msk.md at "${filePath}": ${validationErrors[0] ?? 'unknown error'}`);
    this.name = 'MskReadError';
    this.filePath = filePath;
    this.validationErrors = validationErrors;
    this.rawContent = rawContent;
  }
}

// gray-matter uses js-yaml which auto-parses ISO 8601 strings to Date objects.
// We normalize the known datetime fields back to ISO strings so Zod validation passes.
function normalizeDateFields(data: Record<string, unknown>): Record<string, unknown> {
  const dateFields = ['created_at', 'last_updated_at', 'expires_at'] as const;
  const result: Record<string, unknown> = { ...data };
  for (const field of dateFields) {
    if (result[field] instanceof Date) {
      result[field] = (result[field] as Date).toISOString();
    }
  }
  return result;
}

export async function readNode(filePath: string): Promise<MskNode> {
  let rawContent: string;
  try {
    rawContent = await readFile(filePath, 'utf-8');
  } catch (cause) {
    throw new Error(`Cannot read file at "${filePath}"`, { cause });
  }

  const { data, content } = matter(rawContent);
  const normalized = normalizeDateFields(data as Record<string, unknown>);

  const candidate = {
    ...normalized,
    body: content.trim(),
  };

  const result = validate(candidate);
  if (!result.valid) {
    throw new MskReadError(filePath, result.errors, rawContent);
  }

  return candidate as MskNode;
}

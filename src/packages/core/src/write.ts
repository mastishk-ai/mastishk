import { mkdir, readFile, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import matter from 'gray-matter';
import { validate } from './validate.js';
import { readNode } from './read.js';
import { writeFileAtomic } from './atomic.js';
import type { MskNode } from './schema.js';

export class MskWriteError extends Error {
  readonly filePath: string;
  readonly validationErrors: string[];

  constructor(filePath: string, validationErrors: string[]) {
    super(`Cannot write invalid node to "${filePath}": ${validationErrors.join('; ')}`);
    this.name = 'MskWriteError';
    this.filePath = filePath;
    this.validationErrors = validationErrors;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Remove undefined-valued keys so they don't appear as `null` in YAML output.
// SPEC-GAP: spec does not define how optional fields with no value should be serialized.
function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function serialize(node: MskNode): string {
  const { body, ...rest } = node;
  const frontmatter = stripUndefined(rest as Record<string, unknown>);
  return matter.stringify(body, frontmatter);
}

export async function writeNode(filePath: string, node: MskNode): Promise<void> {
  const result = validate(node);
  if (!result.valid) {
    throw new MskWriteError(filePath, result.errors);
  }

  // Spec section 7.1: always update last_updated_at before writing.
  const updatedNode: MskNode = {
    ...node,
    last_updated_at: new Date().toISOString(),
  };

  await mkdir(dirname(filePath), { recursive: true });

  let content: string;

  if (node.layer === 'state') {
    // Spec section 7.2: state layer writes MUST be append-only.
    const appendHeader = `### ${updatedNode.last_updated_at} — ${updatedNode.last_updated_by}`;

    if (await fileExists(filePath)) {
      const raw = await readFile(filePath, 'utf-8');
      const existingBody = matter(raw).content.trim();
      const newBody = `${existingBody}\n\n${appendHeader}\n\n${updatedNode.body.trim()}`;
      content = serialize({ ...updatedNode, body: newBody });
    } else {
      // First write to a state node: still wrap in the append header format.
      const newBody = `${appendHeader}\n\n${updatedNode.body.trim()}`;
      content = serialize({ ...updatedNode, body: newBody });
    }
  } else {
    // intent, knowledge: replace body content.
    // SPEC-GAP: spec section 4.3 says knowledge writes MUST "preserve the full frontmatter history"
    // but does not define the file format for this. We replace body and update frontmatter fields only.
    // SPEC-GAP: spec section 4.4 says issue nodes must be append-only (never deleted) but does not
    // explicitly require append-only body content the way section 7.2 does for state. Treating as replace.
    content = serialize(updatedNode);
  }

  // Spec section 17.1 — node writes are atomic
  await writeFileAtomic(filePath, content);
}

// SPEC-GAP: spec does not define a metadata-only update path. This is needed by the
// CLI `update` command to change status/confidence without triggering state-layer append.
// Reads the existing file, applies frontmatter-only updates, preserves body exactly.
export async function updateNodeMeta(
  filePath: string,
  updates: Partial<Omit<MskNode, 'id' | 'body'>>
): Promise<void> {
  const existing = await readNode(filePath);
  const updated: MskNode = {
    ...existing,
    ...updates,
    id: existing.id,
    body: existing.body,
    last_updated_at: new Date().toISOString(),
  };
  const result = validate(updated);
  if (!result.valid) {
    throw new MskWriteError(filePath, result.errors);
  }
  await writeFileAtomic(filePath, serialize(updated));
}

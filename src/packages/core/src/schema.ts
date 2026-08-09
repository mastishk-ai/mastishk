import { z } from 'zod';

// Spec section 3.2 — YAML frontmatter enums (v0.3)

export const MskLayerSchema = z.enum(['intent', 'state', 'knowledge', 'map', 'issues']);

export const MskTypeSchema = z.enum([
  'goal',
  'constraint',
  'resource',
  'task',
  'plan',
  'handoff',
  'decision',
  'fact',
  'file',
  'issue',
]);

export const MskStatusSchema = z.enum(['active', 'resolved', 'deprecated', 'draft']);

// Spec section 3.3 — allowed node types per layer
export const LAYER_TYPES: Record<z.infer<typeof MskLayerSchema>, readonly z.infer<typeof MskTypeSchema>[]> = {
  intent: ['goal', 'constraint', 'resource'],
  state: ['task', 'plan', 'handoff'],
  knowledge: ['decision', 'fact'],
  map: ['file'],
  issues: ['issue'],
};

// ISO 8601 datetime — spec requires timestamps in created_at, last_updated_at, expires_at
const iso8601 = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  'Must be an ISO 8601 datetime (e.g. 2026-05-12T00:00:00Z)'
);

// Spec section 3.1 — id must be kebab-case and unique within the project
const kebabCase = z.string().regex(
  /^[a-z0-9]+(-[a-z0-9]+)*$/,
  'Must be kebab-case (lowercase letters, numbers, and hyphens only)'
);

export const MskNodeSchema = z
  .object({
    // --- Required fields (spec section 3.2) ---
    id: kebabCase,
    type: MskTypeSchema,
    layer: MskLayerSchema,
    status: MskStatusSchema,
    confidence: z.number().min(0, 'confidence must be >= 0.0').max(1, 'confidence must be <= 1.0'),
    created_by: z.string().min(1, 'created_by must not be empty'),
    created_at: iso8601,
    last_updated_by: z.string().min(1, 'last_updated_by must not be empty'),
    last_updated_at: iso8601,
    dependencies: z.array(z.string()),
    contradictions: z.array(z.string()),

    // --- Optional fields (spec section 3.2) ---
    tags: z.array(z.string()).optional(),
    scanned: z.boolean().optional(),
    verified: z.boolean().optional(),
    expires_at: iso8601.optional(),
    // v0.3: repo-relative path described by a map node (required when layer is 'map')
    path: z.string().optional(),
    // v0.3: set by ambient capture when a commit touches a map node's path
    stale: z.boolean().optional(),
    // v0.3: ordered task IDs — only meaningful on plan nodes
    steps: z.array(z.string()).optional(),

    // --- Body content (spec section 3.4) ---
    // The markdown body following the YAML frontmatter block.
    // SPEC-GAP: spec says body MUST be valid markdown but does not define it as a named field.
    // We model it as `body: string` on the node for uniform access after gray-matter parsing.
    body: z.string(),
  })
  .superRefine((node, ctx) => {
    // Spec section 3.3 — a write whose type is not allowed in its layer MUST be rejected
    if (!LAYER_TYPES[node.layer].includes(node.type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['type'],
        message: `type "${node.type}" is not allowed in layer "${node.layer}" (allowed: ${LAYER_TYPES[node.layer].join(', ')})`,
      });
    }
    // Spec section 4.4 — map nodes MUST carry the path they describe
    if (node.layer === 'map' && !node.path) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['path'],
        message: 'map nodes must have a "path" field with a repo-relative file or directory path',
      });
    }
    // Spec section 3.2 — steps is only meaningful on plan nodes
    if (node.steps !== undefined && node.type !== 'plan') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['steps'],
        message: '"steps" is only allowed on plan nodes',
      });
    }
  });

export type MskLayer = z.infer<typeof MskLayerSchema>;
export type MskType = z.infer<typeof MskTypeSchema>;
export type MskStatus = z.infer<typeof MskStatusSchema>;
export type MskNode = z.infer<typeof MskNodeSchema>;

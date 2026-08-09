import type { AgentsConfig } from './agents.js';
import { ensureRegistered } from './agents.js';
import type { MskNode } from './schema.js';

// Spec section 17.3 — trust enforcement at write time.
//
//   high   — no restrictions beyond the Referee
//   medium — confidence capped at 0.6; intent/ writes require human confirmation
//   low    — as medium, plus knowledge/ and map/ writes land as status: draft
//   access: read-only — all writes refused
//
// Writes by `human` are not subject to trust enforcement.

export interface TrustDecision {
  allowed: boolean;
  reason?: string;
  /** The node after enforcement (confidence cap, draft-gating) — unchanged if allowed as-is. */
  node: MskNode;
  /** Config extended with an auto-registered agent, when that happened (spec 9). */
  updatedConfig?: AgentsConfig;
}

export function enforceTrust(config: AgentsConfig | null, node: MskNode): TrustDecision {
  const actor = node.last_updated_by;

  if (actor === 'human' || config === null) {
    return { allowed: true, node };
  }

  const { config: nextConfig, agent, registered } = ensureRegistered(config, actor);
  const updatedConfig = registered ? nextConfig : undefined;

  if (agent.access === 'read-only') {
    return {
      allowed: false,
      reason: `agent "${actor}" has read-only access`,
      node,
      updatedConfig,
    };
  }

  if (agent.trust === 'high') {
    return { allowed: true, node, updatedConfig };
  }

  // medium and low: intent writes require human confirmation — refused here;
  // interactive frontends may confirm with the human and re-submit as created_by human.
  if (node.layer === 'intent') {
    return {
      allowed: false,
      reason: `agent "${actor}" (trust: ${agent.trust}) may not write to intent/ without human confirmation`,
      node,
      updatedConfig,
    };
  }

  let enforced: MskNode = { ...node, confidence: Math.min(node.confidence, 0.6) };

  if (agent.trust === 'low' && (node.layer === 'knowledge' || node.layer === 'map')) {
    enforced = { ...enforced, status: 'draft' };
  }

  return { allowed: true, node: enforced, updatedConfig };
}

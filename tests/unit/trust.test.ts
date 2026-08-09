import { describe, it, expect } from 'vitest';
import { enforceTrust, createDefaultAgentsConfig } from '@mastishk/core';
import type { AgentsConfig, MskNode } from '@mastishk/core';

function node(overrides: Partial<MskNode> = {}): MskNode {
  return {
    id: 'fact-orm',
    type: 'fact',
    layer: 'knowledge',
    status: 'active',
    confidence: 0.9,
    created_by: 'some-agent',
    created_at: '2026-06-12T00:00:00Z',
    last_updated_by: 'some-agent',
    last_updated_at: '2026-06-12T00:00:00Z',
    dependencies: [],
    contradictions: [],
    body: 'We use Drizzle ORM.',
    ...overrides,
  };
}

function configWith(trust: 'high' | 'medium' | 'low', access: 'read-write' | 'read-only' = 'read-write'): AgentsConfig {
  return {
    ...createDefaultAgentsConfig(),
    registered_agents: [{ id: 'some-agent', access, trust, last_session_at: null }],
  };
}

describe('enforceTrust — spec section 17.3', () => {
  it('allows everything when agents.json is absent', () => {
    const d = enforceTrust(null, node());
    expect(d.allowed).toBe(true);
    expect(d.node.confidence).toBe(0.9);
  });

  it('never restricts writes by "human"', () => {
    const d = enforceTrust(configWith('low'), node({ last_updated_by: 'human', layer: 'intent', type: 'goal' }));
    expect(d.allowed).toBe(true);
    expect(d.node.confidence).toBe(0.9);
  });

  it('high trust: no restrictions', () => {
    const d = enforceTrust(configWith('high'), node({ layer: 'intent', type: 'goal' }));
    expect(d.allowed).toBe(true);
    expect(d.node.confidence).toBe(0.9);
  });

  it('medium trust: confidence capped at 0.6', () => {
    const d = enforceTrust(configWith('medium'), node());
    expect(d.allowed).toBe(true);
    expect(d.node.confidence).toBe(0.6);
  });

  it('medium trust: intent writes refused', () => {
    const d = enforceTrust(configWith('medium'), node({ layer: 'intent', type: 'goal' }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('intent');
  });

  it('low trust: knowledge writes land as draft', () => {
    const d = enforceTrust(configWith('low'), node());
    expect(d.allowed).toBe(true);
    expect(d.node.status).toBe('draft');
    expect(d.node.confidence).toBe(0.6);
  });

  it('low trust: map writes land as draft', () => {
    const d = enforceTrust(configWith('low'), node({ layer: 'map', type: 'file', path: 'src/a.ts' }));
    expect(d.allowed).toBe(true);
    expect(d.node.status).toBe('draft');
  });

  it('low trust: state writes are allowed without draft-gating', () => {
    const d = enforceTrust(configWith('low'), node({ layer: 'state', type: 'task' }));
    expect(d.allowed).toBe(true);
    expect(d.node.status).toBe('active');
  });

  it('read-only access: all writes refused', () => {
    const d = enforceTrust(configWith('high', 'read-only'), node());
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('read-only');
  });

  it('unknown agent: auto-registered as medium (spec section 9)', () => {
    const config = createDefaultAgentsConfig();
    const d = enforceTrust(config, node({ last_updated_by: 'mystery-agent' }));
    expect(d.allowed).toBe(true);
    expect(d.node.confidence).toBe(0.6);
    expect(d.updatedConfig).toBeDefined();
    const registered = d.updatedConfig!.registered_agents.find((a) => a.id === 'mystery-agent');
    expect(registered?.trust).toBe('medium');
  });
});

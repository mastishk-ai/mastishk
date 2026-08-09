export {
  MskLayerSchema,
  MskTypeSchema,
  MskStatusSchema,
  MskNodeSchema,
} from './schema.js';

export type { MskLayer, MskType, MskStatus, MskNode } from './schema.js';

export { validate } from './validate.js';

export { readNode, MskReadError } from './read.js';

export { writeNode, updateNodeMeta, MskWriteError } from './write.js';

export {
  createEmptyMemoryMap,
  readMemoryMap,
  writeMemoryMap,
  validateGraph,
  assertValidGraph,
  upsertNode,
  removeNode,
  nodeToMapEntry,
  MskGraphError,
} from './graph.js';

export type { MemoryMap, MemoryMapNode, MemoryMapEdge } from './graph.js';

export { traverse } from './traverse.js';

export type { TraverseOptions, TraversalResult } from './traverse.js';

export { inject } from './inject.js';

export { writeFileAtomic } from './atomic.js';

export { acquireLock, MskLockError, LOCK_FILE } from './lock.js';

export type { LockOptions } from './lock.js';

export {
  readAgentsConfig,
  writeAgentsConfig,
  ensureRegistered,
  createDefaultAgentsConfig,
  AGENTS_FILE,
} from './agents.js';

export type {
  AgentsConfig,
  RegisteredAgent,
  ConflictStrategy,
  TrustLevel,
  AccessLevel,
} from './agents.js';

export { referee, createConflictNode } from './referee.js';

export type { RefereeDecision } from './referee.js';

export { enforceTrust } from './trust.js';

export type { TrustDecision } from './trust.js';

export { commitNode } from './commit.js';

export type { CommitResult } from './commit.js';

export { LAYER_TYPES } from './schema.js';

export {
  sessionStart,
  sessionEnd,
  readActiveSessions,
  SESSIONS_DIR,
} from './session.js';

export type {
  ActiveSession,
  SessionStartResult,
  SessionEndOptions,
  SessionEndResult,
} from './session.js';

export { catchup, findNextPlanStep } from './catchup.js';

export { extractKeywords } from './graph.js';

export {
  readMapEntries,
  markStaleByPaths,
  refreshMapNode,
  makeMapNode,
  pathIsCovered,
} from './map.js';

export type { MapEntry, StaleResult } from './map.js';

export { doctor, formatDoctorReport } from './doctor.js';

export type { DoctorReport, DoctorFinding, FindingSeverity } from './doctor.js';

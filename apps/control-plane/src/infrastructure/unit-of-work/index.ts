/**
 * Unit of Work infrastructure module.
 *
 * Exports the SQLite-backed UnitOfWork implementation and repository
 * port adapters for bridging infrastructure repositories to application-layer
 * port interfaces.
 *
 * @module
 */

export { createSqliteUnitOfWork } from "./sqlite-unit-of-work.js";
export {
  createTaskPortAdapter,
  createTaskLeasePortAdapter,
  createReviewCyclePortAdapter,
  createMergeQueueItemPortAdapter,
  createAuditEventPortAdapter,
} from "./repository-adapters.js";

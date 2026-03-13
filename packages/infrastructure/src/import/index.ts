/**
 * Task import infrastructure — markdown and JSON parsing for the import pipeline.
 *
 * @module import
 */

export {
  discoverMarkdownTasks,
  parseTaskFile,
  parseMetadataTable,
  extractSection,
  extractCheckboxItems,
  extractDependencyRefs,
  extractExternalRef,
  extractFileReferences,
  extractTitle,
  parseIndexFile,
  applyOrdering,
  mapTaskType,
  mapPriority,
  findMarkdownFiles,
} from "./markdown-task-parser.js";

export type { ParseTaskFileResult, ParseIndexResult } from "./markdown-task-parser.js";

export {
  parseJsonTasks,
  detectJsonFormat,
  mapBacklogTask,
  mapFlatTask,
  parseBacklogJsonData,
  parseFlatJsonData,
} from "./json-task-parser.js";

export type { ParseJsonTaskResult, JsonFormat } from "./json-task-parser.js";

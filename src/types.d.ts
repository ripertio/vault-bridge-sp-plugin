import { PluginAPI as PublishedPluginAPI } from '@super-productivity/plugin-api';

// ─── Batch operation types (internal Super Productivity API) ─────────────────
// These types match the runtime shapes used by SP's internal batchUpdateForProject.
// They are NOT in the published @super-productivity/plugin-api npm package.

export interface BatchTaskCreate {
  type: 'create';
  /** Temporary ID used to reference this task in subsequent operations before SP assigns a real ID. */
  tempId: string;
  data: {
    title: string;
    parentId?: string | null;
    projectId?: string | null;
    notes?: string;
    isDone?: boolean;
    tagIds?: string[];
  };
}

export interface BatchTaskUpdate {
  type: 'update';
  taskId: string;
  updates: Partial<{
    title: string;
    isDone: boolean;
    parentId: string | null;
    projectId: string | null;
    notes: string;
    subTaskIds: string[];
    tagIds: string[];
    timeEstimate: number;
  }>;
}

export interface BatchTaskDelete {
  type: 'delete';
  taskId: string;
}

export interface BatchTaskReorder {
  type: 'reorder';
  taskIds: string[];
  contextId: string;
  contextType: 'project' | 'task';
}

export type BatchOperation =
  | BatchTaskCreate
  | BatchTaskUpdate
  | BatchTaskDelete
  | BatchTaskReorder;

// ─── Super Productivity internal API extensions ───────────────────────────────
// Used at runtime via the SP plugin host but absent from the published npm package.

declare module '@super-productivity/plugin-api' {
  // Internal hooks not present in the published PluginHooks enum
  enum PluginHooks {
    ANY_TASK_UPDATE = 'ANY_TASK_UPDATE',
    PROJECT_LIST_UPDATE = 'PROJECT_LIST_UPDATE',
  }

  // Re-export internal batch types so test files can import them from the package path
  interface BatchTaskCreate {
    type: 'create';
    tempId: string;
    data: {
      title: string;
      parentId?: string | null;
      projectId?: string | null;
      notes?: string;
      isDone?: boolean;
      tagIds?: string[];
    };
  }

  interface BatchTaskUpdate {
    type: 'update';
    taskId: string;
    updates: Partial<{
      title: string;
      isDone: boolean;
      parentId: string | null;
      projectId: string | null;
      notes: string;
      subTaskIds: string[];
      tagIds: string[];
      timeEstimate: number;
    }>;
  }

  interface BatchTaskDelete {
    type: 'delete';
    taskId: string;
  }

  interface BatchTaskReorder {
    type: 'reorder';
    taskIds: string[];
    contextId: string;
    contextType: 'project' | 'task';
  }

  type BatchOperation =
    | BatchTaskCreate
    | BatchTaskUpdate
    | BatchTaskDelete
    | BatchTaskReorder;

  // Extend PluginAPI with internal methods used by this plugin
  interface PluginAPI {
    /** Called when the application window gains or loses focus. */
    onWindowFocusChange?: (fn: (isFocused: boolean) => void) => void;
    /** Register a handler for messages sent from the plugin's UI frame. */
    onMessage?: (fn: (message: any) => any) => void;
    /** Execute a batch of task operations atomically within a single project. */
    batchUpdateForProject?: (params: {
      projectId: string;
      operations: BatchOperation[];
    }) => Promise<{
      success: boolean;
      createdTaskIds?: Record<string, string>;
      errors?: Array<{ operationIndex: number; type?: string; message: string }>;
    }>;
    /** Structured logger exposed by the SP plugin host. */
    log?: {
      critical: (...args: unknown[]) => void;
      err: (...args: unknown[]) => void;
      error: (...args: unknown[]) => void;
      log: (...args: unknown[]) => void;
      normal: (...args: unknown[]) => void;
      info: (...args: unknown[]) => void;
      verbose: (...args: unknown[]) => void;
      debug: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
    };
  }
}

// ─── Global ───────────────────────────────────────────────────────────────────

declare global {
  var PluginAPI: PublishedPluginAPI;
}

export {};

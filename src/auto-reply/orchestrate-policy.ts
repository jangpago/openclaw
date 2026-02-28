import { normalizeCommandBody } from "./commands-registry.js";

export type OrchestrationMode = "auto" | "direct" | "delegate";

const VALID_MODES = new Set<OrchestrationMode>(["auto", "direct", "delegate"]);

/**
 * Parse `/orchestrate [mode]` command from normalized input.
 */
export function parseOrchestrateCommand(raw?: string): {
  hasCommand: boolean;
  mode?: OrchestrationMode;
} {
  if (!raw) {
    return { hasCommand: false };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { hasCommand: false };
  }
  const normalized = normalizeCommandBody(trimmed);
  const match = normalized.match(/^\/orchestrate(?:\s+([a-zA-Z]+))?\s*$/i);
  if (!match) {
    return { hasCommand: false };
  }
  const token = match[1]?.trim().toLowerCase();
  if (!token) {
    return { hasCommand: true };
  }
  if (VALID_MODES.has(token as OrchestrationMode)) {
    return { hasCommand: true, mode: token as OrchestrationMode };
  }
  return { hasCommand: true };
}

/**
 * Resolve the effective orchestration mode for a given turn.
 *
 * - "direct"   → all tools available (standard mode)
 * - "delegate" → only delegation tools (sessions_spawn, subagents, sessions_list, etc.)
 * - "auto"     → heuristic decides based on message content
 *
 * Returns the resolved mode ("direct" or "delegate") — never "auto".
 */
export function resolveOrchestrationMode(
  mode: OrchestrationMode | undefined,
  userMessage?: string,
): "direct" | "delegate" {
  if (!mode || mode === "direct") {
    return "direct";
  }
  if (mode === "delegate") {
    return "delegate";
  }
  // auto mode: lightweight heuristic
  return shouldDelegate(userMessage) ? "delegate" : "direct";
}

// ---------------------------------------------------------------------------
// Auto-mode heuristic
// ---------------------------------------------------------------------------

/**
 * Lightweight heuristic for auto mode.
 * Returns true if the message likely requires multi-agent delegation.
 *
 * Signals for delegation (complex/research-oriented):
 * - Long messages (> 200 chars)
 * - Multiple questions (question marks)
 * - Research keywords (analyze, compare, investigate, explain, design, architecture)
 * - Multi-step indicators (and, also, then, after that)
 *
 * Signals for direct handling (simple/quick):
 * - Short messages (< 80 chars)
 * - Direct commands (run, execute, read, show, list, cat, grep, find)
 * - File operations (paths, extensions)
 * - Single-word or very terse input
 */
function shouldDelegate(message?: string): boolean {
  if (!message) {
    return false;
  }
  const trimmed = message.trim();
  if (!trimmed || trimmed.length < 40) {
    return false;
  }

  // Strong signals for direct handling — these override length heuristics
  const directPatterns =
    /^(run|exec|execute|read|show|list|cat|grep|find|ls|cd|pwd|git\s|npm\s|pnpm\s|bun\s)\b/i;
  if (directPatterns.test(trimmed)) {
    return false;
  }

  // File path patterns — likely direct operations
  if (/\.(ts|js|json|md|yaml|yml|py|sh|css|html)(\s|$)/i.test(trimmed)) {
    if (trimmed.length < 120) {
      return false;
    }
  }

  // Strong signals for delegation
  const delegateKeywords =
    /\b(analyze|analyse|compare|investigate|explain|design|architect|research|review|evaluate|summarize|pros?\s+and\s+cons?|trade-?offs?|best\s+practice|deep\s+dive|thorough)\b/i;
  if (delegateKeywords.test(trimmed)) {
    return true;
  }

  // Multiple questions suggest complex research
  const questionCount = (trimmed.match(/\?/g) || []).length;
  if (questionCount >= 2) {
    return true;
  }

  // Long messages are more likely complex
  if (trimmed.length > 300) {
    return true;
  }

  // Default: direct handling (conservative — avoid unnecessary delegation overhead)
  return false;
}

// ---------------------------------------------------------------------------
// Tool policy for delegate mode
// ---------------------------------------------------------------------------

/**
 * Delegation-only tool allowlist.
 * When in delegate mode, only these tools are visible to the model.
 */
const DELEGATION_TOOLS = new Set([
  "sessions_spawn",
  "subagents",
  "sessions_list",
  "sessions_history",
  "session_status",
  "message",
]);

/**
 * Build a tool policy that restricts to delegation-only tools.
 * Returns undefined (no restriction) for direct mode.
 */
export function buildOrchestrationToolPolicy(
  resolvedMode: "direct" | "delegate",
): { allow: string[] } | undefined {
  if (resolvedMode === "direct") {
    return undefined;
  }
  return { allow: [...DELEGATION_TOOLS] };
}

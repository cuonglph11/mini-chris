/**
 * Pre-compaction memory flush system.
 *
 * When a conversation nears its context limit, a hidden agentic turn is
 * injected that instructs the LLM to persist any important information to
 * durable memory *before* the context window is compacted.  This prevents
 * valuable context from being silently discarded.
 *
 * Inspired by OpenClaw's memory-flush approach.
 */

export interface FlushConfig {
  enabled: boolean;
  /** Number of conversation turns between flush prompts */
  turnThreshold: number;
  /** System prompt injected for the flush turn */
  systemPrompt: string;
  /** User prompt injected for the flush turn */
  userPrompt: string;
}

export const DEFAULT_FLUSH_CONFIG: FlushConfig = {
  enabled: true,
  turnThreshold: 20,
  systemPrompt:
    'Session nearing context limit. Store any important information to memory now.',
  userPrompt:
    'Review the conversation so far and save any important facts, decisions, or preferences to memory using the memory_save tool. If nothing important needs saving, just say "Nothing to save."',
};

/**
 * Check if a memory flush should be triggered based on turn count.
 *
 * The flush fires every `turnThreshold` turns (e.g. at turn 20, 40, 60 ...)
 * but never twice at the same turn count.
 *
 * @returns `true` when the caller should inject a flush turn.
 */
export function shouldFlushMemory(params: {
  turnCount: number;
  lastFlushAtTurn: number;
  config: FlushConfig;
}): boolean {
  const { turnCount, lastFlushAtTurn, config } = params;

  if (!config.enabled) return false;
  if (turnCount <= 0) return false;
  if (lastFlushAtTurn === turnCount) return false;
  if (turnCount % config.turnThreshold !== 0) return false;

  return true;
}

/**
 * Build the prompt pair to inject as a hidden flush turn.
 */
export function buildFlushPrompt(config: FlushConfig): {
  systemPrompt: string;
  userPrompt: string;
} {
  return {
    systemPrompt: config.systemPrompt,
    userPrompt: config.userPrompt,
  };
}

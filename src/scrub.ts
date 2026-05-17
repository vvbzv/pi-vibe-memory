export interface ScrubOptions {
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 1200;
const REDACTION = "[REDACTED_SECRET]";

const SECRET_PATTERNS: RegExp[] = [
  /\b(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+\/=:-]{12,}/gi,
  /\b(api[_-]?key|apiKey|token|password|secret)\b(\s*[:=]\s*)(["']?)[^\s"',;]{8,}\3/gi,
  /\b(sk-[A-Za-z0-9_-]{16,})\b/g,
  /\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
];

export function truncateText(text: string, maxChars = DEFAULT_MAX_CHARS): string {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}…[truncated ${omitted} chars]`;
}

export function scrubSecrets(text: string, options: ScrubOptions = {}): string {
  let scrubbed = text;
  for (const pattern of SECRET_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, (...args: string[]) => {
      if (args.length >= 5 && /api|token|password|secret/i.test(args[1] ?? "")) {
        return `${args[1]}${args[2]}${REDACTION}`;
      }
      if (/Authorization/i.test(args[1] ?? "")) return `${args[1]}${REDACTION}`;
      return REDACTION;
    });
  }
  return truncateText(scrubbed, options.maxChars ?? DEFAULT_MAX_CHARS);
}

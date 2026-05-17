export interface ScrubOptions {
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 1200;
const REDACTION = "[REDACTED_SECRET]";

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+\/=:-]{12,}/gi,
  /\b([A-Za-z0-9_.-]*(?:api[_-]?key|token|password|secret|access[_-]?key)[A-Za-z0-9_.-]*)(\s*[:=]\s*)(["']?)[^\s"',;]{8,}\3/gi,
  /\b(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s"']+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\b(sk-[A-Za-z0-9_-]{16,})\b/g,
  /\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
];

export function truncateText(text: string, maxChars = DEFAULT_MAX_CHARS): string {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  const suffix = `…[truncated ${text.length - maxChars} chars]`;
  if (suffix.length >= maxChars) return suffix.slice(0, maxChars);
  return `${text.slice(0, maxChars - suffix.length)}${suffix}`;
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

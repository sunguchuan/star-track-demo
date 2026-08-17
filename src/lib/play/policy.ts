import { PLAY_KINDS, type PlayKind } from "./types";
import type { PlayErrorKey } from "./errors";

const BANNED_PATTERNS: RegExp[] = [
  /上分/,
  /代练/,
  /代打/,
  /排位上分/,
  /(帮|代).{0,6}打排位/,
  /账号共享/,
  /借号/,
  /租号/,
  /账号密码/,
  /要密码/,
  /密码发给/,
  /boost/i,
  /elo\s*boost/i,
  /rank\s*boost/i,
  /account\s*shar/i,
];

export function isPlayKind(value: string): value is PlayKind {
  return (PLAY_KINDS as readonly string[]).includes(value);
}

export function findPolicyViolation(
  ...parts: Array<string | undefined>
): PlayErrorKey | null {
  const text = parts.filter(Boolean).join("\n");
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(text)) {
      return "policy_boost";
    }
  }
  return null;
}

export function assertOrderAllowed(input: {
  kind: string;
  title: string;
  game: string;
  details: string;
  seed?: string;
}): { ok: true; kind: PlayKind } | { ok: false; reason: PlayErrorKey } {
  if (!isPlayKind(input.kind)) {
    return { ok: false, reason: "kind_not_allowed" };
  }

  const reason = findPolicyViolation(
    input.title,
    input.game,
    input.details,
    input.seed,
  );
  if (reason) return { ok: false, reason };

  if (input.kind === "seed" && !input.seed?.trim()) {
    return { ok: false, reason: "seed_required" };
  }

  if (!input.game.trim()) {
    return { ok: false, reason: "game_required" };
  }

  if (!input.details.trim() && input.kind !== "seed") {
    return { ok: false, reason: "details_required" };
  }

  return { ok: true, kind: input.kind };
}

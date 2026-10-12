/**
 * Requirement catalog parsing.
 *
 * One normative requirement from a specification, with a stable ID. RFC text is
 * summarized and linked, never copied wholesale. Validated by
 * schemas/requirement.schema.json.
 */

export type RequirementLevel = 'MUST' | 'MUST NOT' | 'SHOULD' | 'SHOULD NOT' | 'MAY';

export const REQUIREMENT_LEVELS: readonly RequirementLevel[] = [
  'MUST',
  'MUST NOT',
  'SHOULD',
  'SHOULD NOT',
  'MAY',
] as const;

export interface Requirement {
  id: string;
  spec: string;
  clause: string;
  level: RequirementLevel;
  profile: string;
  summary: string;
  link: string;
  notes?: string;
}

const ID_PATTERN = /^[A-Z][A-Z0-9]*(?:[0-9])?-[A-Za-z0-9._-]+$/;

function record(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object`);
  }
  return input as Record<string, unknown>;
}

function stringAt(value: unknown, label: string, minLength = 1): string {
  if (typeof value !== 'string' || value.trim().length < minLength) {
    throw new TypeError(`${label} must be a string of at least ${minLength} characters`);
  }
  return value;
}

export function parseRequirement(input: unknown): Requirement {
  const value = record(input, 'requirement');
  const id = stringAt(value.id, 'requirement.id');
  if (!ID_PATTERN.test(id)) {
    throw new TypeError(`requirement.id must be a SCREAMING-KEBAB identifier, got ${id}`);
  }
  const level = stringAt(value.level, 'requirement.level');
  if (!(REQUIREMENT_LEVELS as readonly string[]).includes(level)) {
    throw new TypeError(`requirement.level must be one of ${REQUIREMENT_LEVELS.join(', ')}`);
  }
  const link = stringAt(value.link, 'requirement.link');
  if (!link.startsWith('https://')) throw new TypeError('requirement.link must be an https URL');
  return {
    id,
    spec: stringAt(value.spec, 'requirement.spec'),
    clause: stringAt(value.clause, 'requirement.clause'),
    level: level as RequirementLevel,
    profile: stringAt(value.profile, 'requirement.profile'),
    summary: stringAt(value.summary, 'requirement.summary', 10),
    link,
    ...(value.notes !== undefined ? { notes: stringAt(value.notes, 'requirement.notes') } : {}),
  };
}

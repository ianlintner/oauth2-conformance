/**
 * Profile parsing: a named selection of requirements a server can claim.
 * Validated by schemas/profile.schema.json.
 */

export interface Profile {
  id: string;
  title: string;
  description?: string;
  requirements: string[];
}

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

export function parseProfile(input: unknown): Profile {
  const value = record(input, 'profile');
  const id = stringAt(value.id, 'profile.id');
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new TypeError(`profile.id must be a lowercase identifier, got ${id}`);
  if (!Array.isArray(value.requirements) || value.requirements.length === 0) {
    throw new TypeError('profile.requirements must be a nonempty array');
  }
  return {
    id,
    title: stringAt(value.title, 'profile.title', 3),
    ...(value.description !== undefined ? { description: stringAt(value.description, 'profile.description') } : {}),
    requirements: value.requirements.map((entry, index) => stringAt(entry, `profile.requirements[${index}]`)),
  };
}

/**
 * A scenario belongs to a profile when it is filed under it, or when the
 * scenario *explicitly opts in* to that profile via `profiles`. Membership is
 * never inferred from requirement-ID overlap: a profile that cites a
 * requirement whose canonical fixture lives under another profile does so as
 * intent, not as evidence that the foreign fixture's assumptions hold here
 * (e.g. FAPI2 forbids the public-client no-PAR exchange that
 * `core.pkce.s256-exchanged` performs, and the `client_secret_basic`
 * authentication that `sender-constrained.dpop.jti-replay` relies on).
 */
export function scenarioInProfile(
  scenario: { profile: string; profiles?: string[] },
  profileId: string,
): boolean {
  return scenario.profile === profileId || scenario.profiles?.includes(profileId) === true;
}

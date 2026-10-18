/**
 * Implementation manifest contract reference.
 *
 * A `conformance.yaml` manifest pins its contract as either a tagged semver
 * release or, before that tag exists, a full 40-hex commit SHA on main
 * (ROADMAP.md flow step 2). This parser is the runner's independent gate on
 * that reference, mirroring `implementation-manifest.schema.json`, so a
 * malformed or ambiguous ref is rejected rather than accepted syntactically.
 */

export type ContractRef =
  | { kind: 'version'; value: string }
  | { kind: 'commit'; value: string };

const SEMVER = /^\d+\.\d+\.\d+$/;
const COMMIT = /^[0-9a-f]{40}$/;

/** Classify a contract reference, rejecting any malformed or ambiguous form. */
export function parseContractRef(ref: unknown): ContractRef {
  if (typeof ref !== 'string') {
    throw new Error(`invalid contract reference: expected a string, got ${String(ref)}`);
  }
  if (SEMVER.test(ref)) return { kind: 'version', value: ref };
  if (COMMIT.test(ref)) return { kind: 'commit', value: ref };
  throw new Error(
    `invalid contract reference: ${JSON.stringify(ref)} must be a semver (X.Y.Z) or a full 40-character lowercase commit SHA`,
  );
}

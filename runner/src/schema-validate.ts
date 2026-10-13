/**
 * JSON Schema 2020-12 validation of the contract's data files.
 *
 * Every requirement list, profile, scenario, seed and implementation manifest
 * is validated against its schema in `schemas/` with a real 2020-12 validator
 * (ajv). The runner's own parsers are a second, independent gate; this module
 * is the schema-level gate CI invokes via `conformance validate-schemas`.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

export type DataKind = 'requirement' | 'profile' | 'scenario' | 'seed' | 'manifest' | 'invariant';

const SCHEMA_FILES: Record<DataKind, string> = {
  requirement: 'requirement.schema.json',
  profile: 'profile.schema.json',
  scenario: 'scenario.schema.json',
  seed: 'seed.schema.json',
  manifest: 'implementation-manifest.schema.json',
  invariant: 'invariant.schema.json',
};

export interface SchemaViolation {
  file: string;
  kind: DataKind;
  message: string;
}

export type Validators = Record<DataKind, ValidateFunction>;

export async function loadValidators(schemaDir: string): Promise<Validators> {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  const addFormats = addFormatsModule as unknown as (instance: Ajv2020) => void;
  addFormats(ajv);
  const entries = await Promise.all(
    (Object.keys(SCHEMA_FILES) as DataKind[]).map(async (kind) => {
      const schema = JSON.parse(await readFile(path.join(schemaDir, SCHEMA_FILES[kind]), 'utf8')) as object;
      return [kind, ajv.compile(schema)] as const;
    }),
  );
  return Object.fromEntries(entries) as Validators;
}

export function checkDocument(validators: Validators, kind: DataKind, data: unknown, file = '<inline>'): SchemaViolation[] {
  const validate = validators[kind];
  if (validate(data)) return [];
  const message = (validate.errors ?? [])
    .map((error) => `${error.instancePath === '' ? '/' : error.instancePath} ${error.message ?? 'is invalid'}`)
    .join('; ');
  return [{ file, kind, message }];
}

async function walk(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw cause;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (/\.ya?ml$/.test(entry.name)) files.push(full);
  }
  return files;
}

/** Which schema governs a file, by location and name. */
export function classify(root: string, file: string): DataKind | undefined {
  const relative = path.relative(root, file).split(path.sep);
  const top = relative[0];
  const name = relative[relative.length - 1] ?? '';
  if (top === 'requirements') return 'requirement';
  if (top === 'profiles') return 'profile';
  if (top === 'scenarios') return 'scenario';
  if (top === 'invariants') return 'invariant';
  if (top === 'examples' && name.startsWith('seed')) return 'seed';
  if (top === 'examples' && name.startsWith('conformance')) return 'manifest';
  return undefined;
}

/** Validate every data file under a contract repository root. */
export async function validateRepository(root: string): Promise<{ checked: number; violations: SchemaViolation[] }> {
  const validators = await loadValidators(path.join(root, 'schemas'));
  const violations: SchemaViolation[] = [];
  let checked = 0;
  for (const dir of ['requirements', 'profiles', 'scenarios', 'examples', 'invariants']) {
    for (const file of await walk(path.join(root, dir))) {
      const kind = classify(root, file);
      if (kind === undefined) continue;
      checked += 1;
      try {
        violations.push(...checkDocument(validators, kind, parseYaml(await readFile(file, 'utf8')), path.relative(root, file)));
      } catch (cause) {
        violations.push({ file: path.relative(root, file), kind, message: `unparseable: ${cause instanceof Error ? cause.message : String(cause)}` });
      }
    }
  }
  return { checked, violations };
}

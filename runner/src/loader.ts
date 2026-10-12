/**
 * Scenario discovery: load and validate YAML scenario files under a tree.
 *
 * Replaces the JSON-only loader from typescript-oauth2-server
 * `src/conformance/loader.ts` (@d1999bf): the contract's data files are YAML
 * (validated by schemas/*.schema.json), parsed through `parseScenario` so a
 * malformed scenario fails fast at load time with its file path.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseScenario, type Scenario } from './scenario.js';
import { parseProfile, type Profile } from './profile.js';

export async function loadScenarios(root: string): Promise<Scenario[]> {
  const results: Scenario[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.resolve(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await loadScenarios(full)));
    } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
      const raw = await readFile(full, 'utf8');
      try {
        results.push(parseScenario(parseYaml(raw)));
      } catch (cause) {
        throw new Error(`Invalid scenario ${full}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
      }
    }
  }
  const ids = results.map((scenario) => scenario.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) {
    throw new Error(`duplicate scenario ids: ${[...new Set(duplicates)].join(', ')}`);
  }
  return results;
}

export async function loadProfiles(root: string): Promise<Profile[]> {
  const results: Profile[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isDirectory()) {
      results.push(...(await loadProfiles(path.resolve(root, entry.name))));
    } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
      const full = path.resolve(root, entry.name);
      const raw = await readFile(full, 'utf8');
      try {
        results.push(parseProfile(parseYaml(raw)));
      } catch (cause) {
        throw new Error(`Invalid profile ${full}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
      }
    }
  }
  return results;
}

export async function loadRequirements(root: string): Promise<Requirement[]> {
  const results: Requirement[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isDirectory()) {
      results.push(...(await loadRequirements(path.resolve(root, entry.name))));
    } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
      const full = path.resolve(root, entry.name);
      const raw = await readFile(full, 'utf8');
      const parsed: unknown = parseYaml(raw);
      if (!Array.isArray(parsed)) throw new Error(`Invalid requirement file ${full}: expected a list`);
      parsed.forEach((item, index) => {
        try {
          results.push(parseRequirement(item));
        } catch (cause) {
          throw new Error(
            `Invalid requirement ${full}[${index}]: ${cause instanceof Error ? cause.message : String(cause)}`,
            { cause },
          );
        }
      });
    }
  }
  return results;
}

import { parseRequirement, type Requirement } from './requirement.js';

/**
 * Prometheus text exposition helpers for the conformance runner.
 *
 * `prometheus-sample` extracts one numeric sample from exposition text so a
 * scenario can compare counters across steps with `$gtCapture` (for example:
 * read the failed-authentication counter, fail a login, read it again, assert
 * an increase). It is a runner-only helper: the SUT interface is unchanged.
 * A scenario captures `/metrics` as `text.body` and passes that text back
 * through `with.body` — no new endpoint or query parameter is invented.
 */

import type { ActualResponse } from './compare.js';
import { interpolate } from './scenario.js';
import type { HelperContext } from './runner.js';

interface Sample {
  metric: string;
  labels: Record<string, string>;
  value: number;
}

function unescapeLabel(ch: string): string {
  if (ch === 'n') return '\n';
  if (ch === 't') return '\t';
  return ch; // \" and \\ (Prometheus only escapes these plus \n)
}

/** Parse one exposition sample line. Returns undefined for comments and malformed lines. */
function parseLine(line: string): Sample | undefined {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return undefined;
  const name = /^[a-zA-Z_:][a-zA-Z0-9_:]*/.exec(trimmed)?.[0];
  if (name === undefined) return undefined;

  const labels: Record<string, string> = {};
  let index = name.length;
  if (trimmed[index] === '{') {
    index += 1;
    let key = '';
    let value = '';
    let phase: 'key' | 'value' = 'key';
    let quoted = false;
    let escaped = false;
    let closed = false;
    for (; index < trimmed.length; index += 1) {
      const ch = trimmed[index]!;
      if (phase === 'key') {
        if (ch === '}') {
          closed = true;
          index += 1;
          break;
        }
        if (ch === '=') {
          phase = 'value';
          continue;
        }
        if (ch === ',') {
          key = '';
          continue;
        }
        key += ch;
      } else if (escaped) {
        value += unescapeLabel(ch);
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        if (quoted) {
          labels[key.trim()] = value;
          key = '';
          value = '';
          phase = 'key';
          quoted = false;
        } else {
          quoted = true;
        }
      } else if (quoted) {
        value += ch;
      }
    }
    if (!closed) return undefined;
  }

  const valueToken = trimmed.slice(index).trim().split(/\s+/, 1)[0];
  if (valueToken === undefined || valueToken === '') return undefined;
  const value = Number(valueToken);
  if (!Number.isFinite(value)) return undefined;
  return { metric: name, labels, value };
}

/**
 * Read one sample value from Prometheus text exposition.
 *
 * With no `labels`, the metric must carry no labels (the common shape for a
 * counter such as `oauth2_server_oauth_failed_authentications`). With labels,
 * every requested label must match the sample; extra labels are allowed, and
 * an ambiguous match is an error rather than a silently chosen series.
 */
export function parsePrometheusSample(text: string, metric: string, labels: Record<string, string> = {}): number {
  const requested = Object.entries(labels);
  const matches = text
    .split(/\r?\n/)
    .map(parseLine)
    .filter((sample): sample is Sample => sample !== undefined && sample.metric === metric)
    .filter((sample) => (requested.length === 0
      ? Object.keys(sample.labels).length === 0
      : requested.every(([key, value]) => sample.labels[key] === value)));

  const description = `${metric}${requested.length > 0 ? `{${requested.map(([key, value]) => `${key}="${value}"`).join(',')}}` : ''}`;
  if (matches.length === 0) throw new Error(`prometheus-sample: no sample for ${description} in exposition text`);
  if (matches.length > 1) throw new Error(`prometheus-sample: ${description} matched ${matches.length} samples; add labels to select one`);
  return matches[0]!.value;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`prometheus-sample: with.${name} must be a nonempty string`);
  }
  return value;
}

/** Runner helper: `use: prometheus-sample` returns `{ "value": <number> }` for capture. */
export async function prometheusSample(context: HelperContext): Promise<ActualResponse> {
  const text = interpolate(requireString(context.with.body, 'body'), context.scope);
  const metric = interpolate(requireString(context.with.metric, 'metric'), context.scope);
  const withLabels = context.with.labels;
  let labels: Record<string, string> = {};
  if (withLabels !== undefined) {
    if (typeof withLabels !== 'object' || withLabels === null || Array.isArray(withLabels)) {
      throw new Error('prometheus-sample: with.labels must be an object of label name to value');
    }
    labels = Object.fromEntries(
      Object.entries(withLabels).map(([key, value]) => [key, interpolate(String(value), context.scope)]),
    );
  }
  const value = parsePrometheusSample(text, metric, labels);
  return { status: 200, headers: {}, body: { value } };
}

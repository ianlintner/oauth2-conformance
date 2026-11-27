import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePrometheusSample, prometheusSample } from '../src/prometheus.js';
import { runScenarios, type HelperContext, type RunReport } from '../src/runner.js';
import type { Scenario } from '../src/scenario.js';

const exposition = `# HELP oauth2_server_http_requests_by_class_total Total HTTP requests by status class
# TYPE oauth2_server_http_requests_by_class_total counter
oauth2_server_http_requests_by_class_total{status_class="2xx",job="conformance"} 42
oauth2_server_http_requests_by_class_total{status_class="4xx",job="conformance"} 3
# TYPE oauth2_server_oauth_failed_authentications counter
oauth2_server_oauth_failed_authentications 1
oauth2_server_http_request_duration_seconds_bucket{le="0.1"} 5
oauth2_server_http_request_duration_seconds_bucket{le="+Inf"} 50
oauth2_server_http_request_duration_seconds_sum 12.5
oauth2_server_http_request_duration_seconds_count 50
`;

function context(withArgs: Record<string, unknown>, scope = new Map<string, string>()): HelperContext {
  return {
    with: withArgs,
    scope,
    send: async () => { throw new Error('prometheus-sample must not send HTTP'); },
  } as unknown as HelperContext;
}

test('extracts an unlabelled counter value and ignores comments and other series', () => {
  assert.equal(parsePrometheusSample(exposition, 'oauth2_server_oauth_failed_authentications'), 1);
  assert.equal(parsePrometheusSample(exposition, 'oauth2_server_http_request_duration_seconds_count'), 50);
});

test('selects a labelled sample by exact label value', () => {
  assert.equal(parsePrometheusSample(exposition, 'oauth2_server_http_requests_by_class_total', { status_class: '4xx' }), 3);
  assert.equal(parsePrometheusSample(exposition, 'oauth2_server_http_request_duration_seconds_bucket', { le: '+Inf' }), 50);
});

test('throws when the sample is absent', () => {
  assert.throws(
    () => parsePrometheusSample(exposition, 'oauth2_server_missing_metric'),
    /prometheus-sample: no sample for oauth2_server_missing_metric/,
  );
  assert.throws(
    () => parsePrometheusSample(exposition, 'oauth2_server_oauth_failed_authentications', { status_class: '2xx' }),
    /no sample/,
  );
});

test('throws rather than guessing when labels leave several matches', () => {
  assert.throws(
    () => parsePrometheusSample(exposition, 'oauth2_server_http_requests_by_class_total', { job: 'conformance' }),
    /matched 2 samples/,
  );
});

test('helper interpolates the captured text and returns a numeric capture body', async () => {
  const scope = new Map([['metrics', exposition]]);
  const result = await prometheusSample(context({ body: '{{metrics}}', metric: 'oauth2_server_oauth_failed_authentications' }, scope));
  assert.deepEqual(result, { status: 200, headers: {}, body: { value: 1 } });
});

test('helper validates its inputs and interpolates label values', async () => {
  await assert.rejects(prometheusSample(context({ metric: 'x' })), /with.body must be a nonempty string/);
  await assert.rejects(prometheusSample(context({ body: 'x' })), /with.metric must be a nonempty string/);
  await assert.rejects(prometheusSample(context({ body: 'x', metric: 'x', labels: 3 })), /with.labels must be an object/);
  const scope = new Map([['klass', '2xx']]);
  const result = await prometheusSample(context({ body: exposition, metric: 'oauth2_server_http_requests_by_class_total', labels: { status_class: '{{klass}}' } }, scope));
  assert.deepEqual(result.body, { value: 42 });
});

const before = `# TYPE oauth2_server_oauth_failed_authentications counter
oauth2_server_oauth_failed_authentications 4
`;
const after = `# TYPE oauth2_server_oauth_failed_authentications counter
oauth2_server_oauth_failed_authentications 6
`;

const comparisonScenario: Scenario = {
  id: 'operations.runtime.prometheus-counter-grows',
  title: 'A failed authentication increments the exported counter',
  requirements: ['OPS-3.3-metrics-failed-authentications-counter'],
  profile: 'operations',
  status: 'stable',
  steps: [
    { id: 'read-before', use: 'prometheus-sample', with: { body: before, metric: 'oauth2_server_oauth_failed_authentications' }, capture: { before: 'body.value' } },
    { id: 'read-after', use: 'prometheus-sample', with: { body: after, metric: 'oauth2_server_oauth_failed_authentications' }, capture: { after: 'body.value' } },
    { id: 'grew', assert: { json: { after: { $gtCapture: ['after', 'before'] } } } },
  ],
};

test('runner wires the helper into capture and $gtCapture assertions', async () => {
  const report: RunReport = await runScenarios([comparisonScenario], {
    baseUrl: 'http://127.0.0.1:9',
    implementation: 'test',
    contract: '0.1.0',
    helpers: { 'prometheus-sample': prometheusSample },
  });
  assert.equal(report.verdict, 'pass', JSON.stringify(report.results));
  const failure: Scenario = {
    ...comparisonScenario,
    steps: [
      comparisonScenario.steps[0]!,
      { id: 'read-after', use: 'prometheus-sample', with: { body: before, metric: 'oauth2_server_oauth_failed_authentications' }, capture: { after: 'body.value' } },
      comparisonScenario.steps[2]!,
    ],
  };
  const failed: RunReport = await runScenarios([failure], {
    baseUrl: 'http://127.0.0.1:9',
    implementation: 'test',
    contract: '0.1.0',
    helpers: { 'prometheus-sample': prometheusSample },
  });
  assert.equal(failed.verdict, 'fail');
});

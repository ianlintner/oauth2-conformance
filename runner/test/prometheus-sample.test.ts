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

test('helper interpolates label names as well as label values', async () => {
  const scope = new Map([['klassLabel', 'status_class'], ['klass', '2xx']]);
  const result = await prometheusSample(
    context({ body: exposition, metric: 'oauth2_server_http_requests_by_class_total', labels: { '{{klassLabel}}': '{{klass}}' } }, scope),
  );
  assert.deepEqual(result.body, { value: 42 });
});

test('parseSutConfig accepts and validates the harness metrics family map', async () => {
  const { parseSutConfig } = await import('../src/sut-runtime.js');
  const cfg = await parseSutConfig('metrics:\n  requestsTotal: my_http_total\n  statusClassLabel: status_class\n  successStatusClass: "2xx"\n', '/tmp');
  assert.equal(cfg.metrics?.requestsTotal, 'my_http_total');
  assert.equal(cfg.metrics?.statusClassLabel, 'status_class');
  await assert.rejects(parseSutConfig('metrics:\n  requestsTotal: "not a metric"\n', '/tmp'), /valid Prometheus metric name/);
  await assert.rejects(parseSutConfig('metrics:\n  statusClassLabel: "bad-label"\n', '/tmp'), /valid Prometheus label name/);
  await assert.rejects(parseSutConfig('metrics:\n  surprise: x\n', '/tmp'), /unknown key "surprise"/);
});

const portableBefore = '# TYPE my_by_class counter\nmy_by_class{my_class="2xx"} 4\n';
const portableAfter = '# TYPE my_by_class counter\nmy_by_class{my_class="2xx"} 6\n';

const portableScenario: Scenario = {
  id: 'operations.runtime.prometheus-configured-families',
  title: 'Family and label names come from harness config',
  requirements: ['OPS-3.3-metrics-request-counter-status-class'],
  profile: 'operations',
  status: 'stable',
  steps: [
    { id: 'read-before', use: 'prometheus-sample', with: { body: portableBefore, metric: '{{metrics.requestsByStatusClass}}', labels: { '{{metrics.statusClassLabel}}': '{{metrics.successStatusClass}}' } }, capture: { before: 'body.value' } },
    { id: 'read-after', use: 'prometheus-sample', with: { body: portableAfter, metric: '{{metrics.requestsByStatusClass}}', labels: { '{{metrics.statusClassLabel}}': '{{metrics.successStatusClass}}' } }, capture: { after: 'body.value' } },
    { id: 'grew', assert: { json: { after: { $gtCapture: ['after', 'before'] } } } },
  ],
};

const baseOpts: Parameters<typeof runScenarios>[1] = {
  baseUrl: 'http://127.0.0.1:9',
  implementation: 'test',
  contract: '0.1.0',
  helpers: { 'prometheus-sample': prometheusSample },
};

test('runner seeds metric variables from --sut-config and fails closed without them', async () => {
  const configured = await runScenarios([portableScenario], {
    ...baseOpts,
    sut: { metrics: { requestsByStatusClass: 'my_by_class', statusClassLabel: 'my_class', successStatusClass: '2xx' } },
  });
  assert.equal(configured.verdict, 'pass', JSON.stringify(configured.results));

  const unconfigured = await runScenarios([portableScenario], baseOpts);
  assert.equal(unconfigured.verdict, 'fail');
});

test('$gtCapture accepts decimal and exponent captures from exposition text', async () => {
  const literal: Scenario = {
    id: 'operations.runtime.gt-exponent-capture',
    title: 'Numeric capture comparison accepts exponent notation',
    requirements: ['OPS-3.3-metrics-duration-histogram'],
    profile: 'operations',
    status: 'stable',
    steps: [
      { id: 'before', use: 'literal', with: { value: '1.5' }, capture: { before: 'body.value' } },
      { id: 'after', use: 'literal', with: { value: '1e+06' }, capture: { after: 'body.value' } },
      { id: 'grew', assert: { json: { after: { $gtCapture: ['after', 'before'] } } } },
    ],
  };
  const report = await runScenarios([literal], {
    baseUrl: 'http://127.0.0.1:9',
    implementation: 'test',
    contract: '0.1.0',
    helpers: {
      literal: async (ctx) => ({ status: 200, headers: {}, body: { value: ctx.with.value } }),
    },
  });
  assert.equal(report.verdict, 'pass', JSON.stringify(report.results));
});

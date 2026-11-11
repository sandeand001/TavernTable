import {
  ErrorHandler,
  ERROR_CATEGORY,
  ERROR_SEVERITY,
} from '../../../../src/utils/error/ErrorHandler.js';

function fixture() {
  return Object.assign(Object.create(ErrorHandler.prototype), {
    config: { maxLogEntries: 1000 },
    errorLog: [],
    errorCounts: new Map(),
    logger: { log: jest.fn() },
    notificationManager: { show: jest.fn() },
    telemetryManager: { report: jest.fn() },
  });
}

test('repeated rendering failures generate one frequency alert without warning recursion', () => {
  const handler = fixture();
  for (let count = 0; count < 25; count++)
    handler.handle(
      new RangeError('The geometry query is outside the board'),
      ERROR_SEVERITY.ERROR,
      ERROR_CATEGORY.RENDERING
    );
  const originals = handler.errorLog.filter((entry) => entry.severity === ERROR_SEVERITY.ERROR);
  const warnings = handler.errorLog.filter((entry) => entry.severity === ERROR_SEVERITY.WARNING);
  expect(originals).toHaveLength(25);
  expect(warnings.map((entry) => entry.message)).toEqual([
    'High frequency error detected: The geometry query is outside the board',
  ]);
  expect(warnings[0].context.frequency).toBe(5);
  expect(
    handler.errorCounts.get(`${ERROR_CATEGORY.RENDERING}:The geometry query is outside the board`)
  ).toBe(25);
  expect(handler.errorCounts.size).toBe(1);
});

test('frequency alerts for different source categories cannot trigger another frequency alert', () => {
  const handler = fixture();
  const categories = Object.values(ERROR_CATEGORY).slice(0, 5);
  for (const category of categories)
    for (let count = 0; count < 5; count++)
      handler.handle('A repeated load failure', ERROR_SEVERITY.ERROR, category);
  const warnings = handler.errorLog.filter((entry) => entry.severity === ERROR_SEVERITY.WARNING);
  expect(warnings).toHaveLength(categories.length);
  expect(
    warnings.every(
      (entry) => entry.message === 'High frequency error detected: A repeated load failure'
    )
  ).toBe(true);
  expect(handler.errorCounts.size).toBe(categories.length);
});

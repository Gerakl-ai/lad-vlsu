async function waitForAsyncCondition(page, predicate, argument, timeout = 30000) {
  // evaluate awaits Promise predicates; waitForFunction in Playwright 1.63 does not.
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await page.evaluate(predicate, argument);
    if (result) return result;
    await page.waitForTimeout(100);
  }
  throw new Error(`Async browser condition was not satisfied within ${timeout}ms`);
}

module.exports = { waitForAsyncCondition };

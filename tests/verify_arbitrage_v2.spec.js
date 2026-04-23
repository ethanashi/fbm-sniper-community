import { test, expect } from '@playwright/test';

test('Verify Multi-Region Arbitrage UI', async ({ page }) => {
  await page.goto('http://localhost:3000');

  // Navigate to Arbitrage tab
  await page.click('a[onclick*="arbitrage"]');

  // Check for the new chart container and summary div
  const chartContainer = await page.locator('#arbitrage-chart-container');
  await expect(chartContainer).toBeVisible();

  const summaryDiv = await page.locator('#arbitrage-best-summary');
  await expect(summaryDiv).toBeDefined();

  // Mock a multi-region deal message
  await page.evaluate(() => {
    const mockDeal = {
        platform: 'arbitrage',
        timestamp: new Date().toISOString(),
        volume: 5000,
        roi: 2.5,
        fiat: 'ARS',
        all_results: [
            { fiat: 'ARS', roi: 2.5, volume: 5000 },
            { fiat: 'VES', roi: 3.1, volume: 2000 }
        ]
    };
    // Call the function that handles new deals
    window.renderSniperFeed('arbitrage');
    // Simulate receiving a message (in a real scenario this comes via event source)
    // We can't easily trigger the EventSource listener, but we can call the update function directly if exported,
    // or just check if the initial empty state is correct and the code for summary update is present.

    // Let's check if the function updateArbitrageChart exists
    if (typeof window.updateArbitrageChart === 'function') {
        window.updateArbitrageChart(mockDeal);
    }
  });

  // Verify the summary card appeared
  const statValue = await page.locator('.stat-value').first();
  await expect(statValue).toContainText('3.10%'); // VES ROI was higher

  const pathValue = await page.locator('.stat-value').nth(1);
  await expect(pathValue).toContainText('VES');

  await page.screenshot({ path: 'arbitrage-multi-region.png' });
});

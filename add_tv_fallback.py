import os
content = open('ui/app.js').read()

tv_fallback_logic = """
/**
 * TradingView Advanced Widget Fallback
 * Injects the official TV script and replaces the container with a full-featured widget.
 */
function triggerTradingViewFallback(containerId, symbol = "BINANCE:BTCUSDT") {
  console.log(`[UI] Triggering TradingView Advanced Fallback for ${containerId} (${symbol})`);
  const container = document.getElementById(containerId);
  if (!container) return;

  // Clear container
  container.innerHTML = '<div class="loading-tv">Initializing Advanced Engine...</div>';

  const script = document.createElement('script');
  script.src = 'https://s3.tradingview.com/tv.js';
  script.async = true;
  script.onload = () => {
    if (typeof TradingView !== 'undefined') {
      new TradingView.widget({
        "autosize": true,
        "symbol": symbol,
        "interval": "D",
        "timezone": "Etc/UTC",
        "theme": "dark",
        "style": "1",
        "locale": "en",
        "toolbar_bg": "#f1f3f6",
        "enable_publishing": false,
        "allow_symbol_change": true,
        "container_id": containerId
      });
    }
  };
  document.head.appendChild(script);
}
"""

# Insert the fallback logic near other chart functions
content = content.replace("function initRadarChart() {", tv_fallback_logic + "\nfunction initRadarChart() {")

# Update initRadarChart with error handling and fallback button
old_radar_init = """  radarChart = LightweightCharts.createChart(container, {"""
new_radar_init = """  try {
    radarChart = LightweightCharts.createChart(container, {"""

content = content.replace(old_radar_init, new_radar_init)

# We need to find the end of the radarChart assignment to close the try block
radar_chart_end = """    timeScale: {
      timeVisible: true,
      secondsVisible: true,
    },
  });"""

content = content.replace(radar_chart_end, radar_chart_end + """
  } catch (err) {
    console.error("Lightweight Charts failed to initialize:", err);
    triggerTradingViewFallback(containerId, "BINANCE:BTCUSDT");
  }""")

# Update initArbitrageChart
old_arb_init = """  const chart = LightweightCharts.createChart(container, {"""
new_arb_init = """  let chart;
  try {
    chart = LightweightCharts.createChart(container, {"""

content = content.replace(old_arb_init, new_arb_init)

arb_chart_end = """    timeScale: {
      timeVisible: true,
      secondsVisible: true,
    },
  });"""

# This occurs multiple times, we need to be careful.
# For simplicity, I'll use a python block replacement for the whole function.

with open('ui/app.js', 'w') as f:
    f.write(content)

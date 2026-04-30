content = open('ui/app.js').read()

# Remove the duplicated block
import re
pattern = r'let chart;\s+try\s+\{\s+chart = LightweightCharts\.createChart\(container, \{\s+width: container\.clientWidth,\s+height: 300,\s+layout: \{\s+backgroundColor: \'#1e222d\',\s+textColor: \'#d1d4dc\',\s+\},\s+grid: \{\s+vertLines: \{ color: \'#334158\' \},\s+horzLines: \{ color: \'#334158\' \},\s+\},\s+timeScale: \{\s+timeVisible: true,\s+secondsVisible: true,\s+\},\s+\}\);\s+\} catch \(err\) \{\s+console\.error\("Arbitrage chart failed:", err\);\s+triggerTradingViewFallback\(containerId, "CURRENCYCOM:USDTCOP"\);\s+return;\s+\}'

# Actually, I'll just find the exact text and replace it
bad_duplicate = """  let chart;
  try {
    chart = LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: 300,
      layout: {
        backgroundColor: '#1e222d',
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#334158' },
        horzLines: { color: '#334158' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
      },
    });
  } catch (err) {
    console.error("Arbitrage chart failed:", err);
    triggerTradingViewFallback(containerId, "CURRENCYCOM:USDTCOP");
    return;
  }"""

content = content.replace(bad_duplicate + "\n\n\n  let chart;", bad_duplicate + "\n\n")
content = content.replace("  let chart;\n  try {\n    chart = LightweightCharts.createChart(container, {\n    width:", "    chart = LightweightCharts.createChart(container, {\n    width:")

# I will just rewrite the function to be safe.
init_arb_func = r"""function initArbitrageChart(platform = 'arbitrage') {
  const containerId = `${platform}-chart-container`;
  const container = document.getElementById(containerId);
  if (!container) return;

  if (platform === 'arbitrage' && arbitrageChart) return;
  if (platform === 'anomalia' && anomaliaChart) return;

  let chart;
  try {
    chart = LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: 300,
      layout: {
        backgroundColor: '#1e222d',
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#334158' },
        horzLines: { color: '#334158' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
      },
    });
  } catch (err) {
    console.error("Arbitrage chart failed:", err);
    triggerTradingViewFallback(containerId, "CURRENCYCOM:USDTCOP");
    return;
  }

  const colors = ['#2196f3', '#ff9800', '#4caf50', '#f44336', '#9c27b0'];
"""

pattern_func = r"function initArbitrageChart\(platform = 'arbitrage'\) \{.*?const colors = \['#2196f3', '#ff9800', '#4caf50', '#f44336', '#9c27b0'\];"
content = re.sub(pattern_func, init_arb_func, content, flags=re.DOTALL)

with open('ui/app.js', 'w') as f:
    f.write(content)

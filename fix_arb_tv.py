import re
content = open('ui/app.js').read()

def replace_init_arb(match):
    platform = match.group(1)
    return f"""function initArbitrageChart({platform}) {{
  const containerId = `${{platform}}-chart-container`;
  const container = document.getElementById(containerId);
  if (!container) return;

  if (platform === 'arbitrage' && arbitrageChart) return;
  if (platform === 'anomalia' && anomaliaChart) return;

  let chart;
  try {{
    chart = LightweightCharts.createChart(container, {{
      width: container.clientWidth,
      height: 300,
      layout: {{
        backgroundColor: '#1e222d',
        textColor: '#d1d4dc',
      }},
      grid: {{
        vertLines: {{ color: '#334158' }},
        horzLines: {{ color: '#334158' }},
      }},
      timeScale: {{
        timeVisible: true,
        secondsVisible: true,
      }},
    }});
  }} catch (err) {{
    console.error("Arbitrage chart failed:", err);
    triggerTradingViewFallback(containerId, "CURRENCYCOM:USDTCOP");
    return;
  }}
"""

content = re.sub(r'function initArbitrageChart\((.*?)\) \{.*?if \(platform === \'anomalia\' && anomaliaChart\) return;',
                 replace_init_arb, content, flags=re.DOTALL)

# Add fallback buttons to the UI panels
# Spot Radar Header
old_radar_header = """<div class="spot-radar-header">
      <div class="spot-radar-title">Global Spot Radar</div>"""
new_radar_header = """<div class="spot-radar-header">
      <div class="spot-radar-title">Global Spot Radar</div>
      <button class="btn btn-secondary btn-sm" onclick="triggerTradingViewFallback('radar-chart-container', 'BINANCE:BTCUSDT')" title="Switch to Advanced Engine if chart fails">Chart Fallback</button>"""

content = content.replace(old_radar_header, new_radar_header)

# Arbitrage Header
old_arb_header = """<div class="tools-panel" style="flex-wrap: wrap; height: auto; gap: 1rem;">"""
new_arb_header = """<div class="tools-panel" style="flex-wrap: wrap; height: auto; gap: 1rem;">
            <button class="btn btn-secondary btn-sm" onclick="triggerTradingViewFallback('${platform}-chart-container', 'CURRENCYCOM:USDTCOP')" style="position: absolute; right: 2rem; top: 1rem;">Chart Fallback</button>"""

content = content.replace(old_arb_header, new_arb_header)

with open('ui/app.js', 'w') as f:
    f.write(content)

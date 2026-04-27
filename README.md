# FBM Sniper & Crypto Arbitrage System

A powerful, open-source multi-platform tool for marketplace sniping and real-time P2P crypto arbitrage. This project is designed for power users and traders looking to exploit price inefficiencies across various physical and digital markets.

## What It Does

This application functions as a comprehensive monitoring dashboard and automated alerting system for two primary domains:

1.  **Marketplace Sniping:** Tracks high-demand electronics and vehicles across multiple platforms:
    *   Facebook Marketplace (Electronics)
    *   Vinted (Worldwide support)
    *   MercadoLibre (17+ countries)
    *   Amazon (Price-drop monitoring)
2.  **P2P Crypto Arbitrage:** Real-time liquidity scanning to identify "Currency Dropshipping" opportunities. It detects spreads between different fiat currencies (e.g., buying USDT with COP and selling for ARS) using the Binance P2P BAPI.
3.  **Crypto Spot Arbitrage:** High-frequency monitoring of price spreads between global spot exchanges. Supports **Spatial (Inter-Exchange)** and **Triangular (Single Exchange)** strategies.
4.  **Global Spot Radar:** An agnostic real-time "radar" that tracks price inefficiencies across exchanges without being tied to any single execution platform.

## Key Features

*   **Modular Arbitrage Hub:** Toggle between different arbitrage strategies (P2P, Spatial, Triangular) without UI clutter. Includes user-defined capital and ROI thresholds.
*   **Tactical Radar Terminal:** Advanced UI controls including a dynamic **Noise Filter** with custom profit thresholds and **Audio Alerts** (chimes).
*   **Interactive Onboarding:** Comprehensive built-in tutorials for every trading mode, explaining what the tool does, how to interpret results (ROI, Volume, Route), and the math behind the arbitrage.
*   **Real-Time Dashboard:** A unified UI to monitor all active bots, logs, and found matches.
*   **Advanced Filtering:** AI-free, robust Regex-based filtering with customizable blacklists and whitelists.
*   **Mathematical Trading Logic:**
    *   **ROI & Net Profit Calculators:** Set strict financial triggers for alerts.
    *   **Z-Score Anomaly Detection:** Identifies "too good to be true" deals based on historical statistical baselines.
*   **Market Depth Analysis:** Tracks tradable volume and liquidity to ensure opportunities are actionable.
*   **Cross-Exchange Engine:** Simultaneously evaluates multiple P2P exchanges (Binance, Airtm, El Dorado) to find the most profitable route.
*   **Dynamic Fee Aggregation:** Automatically calculates net ROI by summing source and destination platform fees.
*   **Combinatorial Arbitrage:** Analyzes all possible combinations of source/destination exchanges and fiat currencies.
*   **Privacy & Security:** Runs entirely locally. No external APIs except for the target marketplaces. Native Node.js implementation without heavy frameworks like Express.
*   **Operational Control:** Includes a secure WebSocket handshake with session-based authentication and a global "Emergency Halt" kill switch for immediate risk mitigation.
*   **Anti-Slippage UI (Spot):** One-click clipboard copying for prices/volume and direct "Deep Link" buttons to exchange trading pairs to minimize human reaction time.
*   **Tactical Radar Terminal:** Advanced UI controls including a dynamic **Noise Filter** with custom profit thresholds and **Audio Alerts** (chimes) to minimize human reaction time for profitable opportunities.
*   **Historical Analytics & Heatmaps:** Asynchronous data logging of all profitable opportunities to SQLite. Visualize recurring market inefficiencies with a 24/7 Heatmap and predictive probability statistics.
*   **Real-Time Spread Charting:** Visualization of the "Spread Gap" using TradingView Lightweight Charts, plotting Ask and Bid prices from multiple exchanges on a single timeline.

## Tech Stack

*   **Backend:** Node.js (Native `http` module, ESM)
*   **Database:** SQLite (Listing deduplication and price history)
*   **Scraping & Automation:** Puppeteer Stealth, Native `fetch` with Proxy support
*   **Frontend:** Vanilla JS, HTML5, CSS3
*   **Visualization:** TradingView Lightweight Charts
*   **Communication:** WebSockets (Real-time data streaming)

## Installation & Setup

### Prerequisites
*   Node.js 18 or higher
*   Git

### Step-by-Step Tutorial

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/your-repo/fbm-sniper-community.git
    cd fbm-sniper-community
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Seed Initial Data:**
    ```bash
    npm run seed
    ```

4.  **Run the Application:**
    *   **UI Mode (Web Dashboard):**
        ```bash
        npm run ui
        ```
        Open `http://localhost:3340` in your browser.
    *   **Desktop Mode (Electron):**
        ```bash
        npm run desktop
        ```

5.  **Initial Configuration:**
    *   Go to the **Config** tab in the dashboard.
    *   Set your **Latitude/Longitude** for marketplace radius searches.
    *   (Optional) Configure **Discord Webhooks** for remote notifications.
    *   Configure your **Arbitrage Fiat Pairs** (e.g., Origin: COP, Destinations: ['ARS', 'VES']).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

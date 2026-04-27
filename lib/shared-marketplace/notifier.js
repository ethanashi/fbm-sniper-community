import fetch from 'node-fetch';
import { spawn } from "node:child_process";

import { loadWorkspaceConfig } from "./workspace.js";

const GRADE_GREEN = new Set(["A", "B"]);
const GRADE_YELLOW = new Set(["C", "D"]);

export function resolveNotificationConfig(config = loadWorkspaceConfig()) {
  const notifications = config?.notifications && typeof config.notifications === "object"
    ? config.notifications
    : {};
  const discord = notifications.discord && typeof notifications.discord === "object"
    ? notifications.discord
    : {};

  const includePhotos = notifications.includePhotos !== false;
  const maxPhotos = Math.min(5, Math.max(1, Number(notifications.maxPhotos || 3) || 3));
  const autoOpenBrowser = String(notifications.autoOpenBrowser || "default").trim().toLowerCase() || "default";
  const allWebhookUrl = String(discord.allWebhookUrl || "").trim();
  const buyNowWebhookUrl = String(discord.buyNowWebhookUrl || "").trim();
  const maybeWebhookUrl = String(discord.maybeWebhookUrl || "").trim();

  return {
    enabled: Boolean(allWebhookUrl || buyNowWebhookUrl || maybeWebhookUrl),
    includePhotos,
    maxPhotos,
    autoOpenBrowser,
    discord: { allWebhookUrl, buyNowWebhookUrl, maybeWebhookUrl },
  };
}

export function selectDiscordTargets(record, notifications) {
  const targets = [];
  const seen = new Set();
  const add = (name, webhookUrl) => {
    const clean = String(webhookUrl || "").trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    targets.push({ name, webhookUrl });
  };

  add("All Deals", notifications?.discord?.allWebhookUrl);
  if (GRADE_GREEN.has(String(record?.grade || "").toUpperCase())) add("Buy Now", notifications?.discord?.buyNowWebhookUrl);
  if (GRADE_YELLOW.has(String(record?.grade || "").toUpperCase())) add("Maybe", notifications?.discord?.maybeWebhookUrl);

  return targets;
}

function gradeColor(grade) {
  const normalized = String(grade || "").toUpperCase();
  if (GRADE_GREEN.has(normalized)) return 0x3fb950;
  if (GRADE_YELLOW.has(normalized)) return 0xd4a72c;
  return 0x6e7681;
}

function collectPhotoUrls(record, maxPhotos) {
  const sources = [
    ...(Array.isArray(record?.listing?.photos) ? record.listing.photos : []),
    ...(Array.isArray(record?.item?.photos) ? record.item.photos : []),
  ];

  return sources
    .map((photo) => {
      if (typeof photo === "string") return photo;
      return photo?.full_size_url || photo?.full_url || photo?.url || photo?.imageUrl || "";
    })
    .filter(Boolean)
    .slice(0, maxPhotos);
}

export function buildDiscordEmbeds(record, notifications) {
  const fields = [
    { name: "Platform", value: String(record?.platform || "unknown"), inline: true },
    { name: "Grade", value: String(record?.grade || "?"), inline: true },
    { name: "Listed", value: `EUR ${record?.listing_price ?? "?"}`, inline: true },
    { name: "Score", value: String(record?.score ?? "?"), inline: true },
    { name: "Target", value: String(record?.target?.label || record?.query || "Custom target"), inline: true },
    { name: "Group", value: String(record?.target?.group || "General"), inline: true },
  ];

  if (record?.max_buy != null) fields.push({ name: "Max Buy", value: `EUR ${record.max_buy}`, inline: true });
  if (record?.max_buy_all_in != null) fields.push({ name: "Max All-In", value: `EUR ${record.max_buy_all_in}`, inline: true });
  if (record?.ceiling != null) fields.push({ name: "Ceiling", value: `EUR ${record.ceiling}`, inline: true });
  if (record?.savings != null) fields.push({ name: "Savings", value: `EUR ${record.savings}`, inline: true });
  if (record?.condition) fields.push({ name: "Condition", value: String(record.condition), inline: true });
  if (record?.battery_health != null) fields.push({ name: "Battery", value: `${record.battery_health}%`, inline: true });
  if (record?.photo_count != null) fields.push({ name: "Photos", value: String(record.photo_count), inline: true });
  if (record?.seller?.name) fields.push({ name: "Seller", value: `${record.seller.name} (${record.seller.rating ?? "n/a"})`, inline: true });
  if (record?.seller?.item_count != null) fields.push({ name: "Seller Items", value: String(record.seller.item_count), inline: true });
  if (record?.fees) {
    fields.push({
      name: "Fees",
      value: `BP EUR ${record.fees.buyerProtection ?? 0} | Ship EUR ${record.fees.shipping ?? 0} | Total EUR ${record.fees.total ?? 0}`,
      inline: false,
    });
  }

  const photos = notifications?.includePhotos ? collectPhotoUrls(record, notifications.maxPhotos) : [];
  const color = gradeColor(record?.grade);
  const embeds = [{
    title: String(record?.title || record?.model || "Marketplace deal").slice(0, 240),
    url: record?.url || undefined,
    color,
    description: (Array.isArray(record?.reasons) ? record.reasons : []).slice(0, 4).join("\n") || undefined,
    fields,
    footer: {
      text: `${String(record?.platform || "marketplace")} • ${String(record?.product || "deal")}`,
    },
    image: photos[0] ? { url: photos[0] } : undefined,
  }];

  for (const photoUrl of photos.slice(1)) {
    embeds.push({
      url: record?.url || undefined,
      image: { url: photoUrl },
      color,
    });
  }

  return embeds;
}

function maybeOpenBrowser(url, notifications) {
  if (!url || notifications?.autoOpenBrowser !== "default") return;
  if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
}

export async function notify(record, options = {}) {
  const notifications = options.config || resolveNotificationConfig(loadWorkspaceConfig());
  const post = typeof options.post === "function"
    ? options.post
    : async (url, payload, requestOptions) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), requestOptions.timeout || 15000);
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res;
        } finally {
          clearTimeout(timeout);
        }
      };
  const openBrowser = typeof options.openBrowser === "function" ? options.openBrowser : maybeOpenBrowser;

  if (!notifications.enabled) return { sent: false, routes: [] };

  const targets = selectDiscordTargets(record, notifications);
  if (!targets.length) return { sent: false, routes: [] };

  const payload = {
    embeds: buildDiscordEmbeds(record, notifications),
    components: record?.url
      ? [{
        type: 1,
        components: [{ type: 2, style: 5, label: "Open Listing", url: record.url }],
      }]
      : undefined,
  };

  const deliveries = await Promise.allSettled(
    targets.map(async (target) => {
      await post(target.webhookUrl, payload, { timeout: 15000 });
      return target.name;
    }),
  );

  const routes = [];
  for (const [index, delivery] of deliveries.entries()) {
    if (delivery.status === "fulfilled") {
      routes.push(delivery.value);
      continue;
    }

    const target = targets[index];
    const error = delivery.reason instanceof Error ? delivery.reason : new Error(String(delivery.reason));
    console.error(`[notify] ${target.name} failed: ${error.message}`);
  }

  if (routes.length) openBrowser(record?.url, notifications);
  return { sent: routes.length > 0, routes };
}

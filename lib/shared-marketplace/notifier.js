/**
 * Notification dispatcher — stub for Phase 3.
 *
 * Phase 3 will implement 3-channel Discord routing:
 *   allWebhookUrl      → every deal
 *   buyNowWebhookUrl   → grade A/B deals (price ≤ maxBuy)
 *   maybeWebhookUrl    → grade C/D deals (lowball range)
 */

export function resolveNotificationConfig() {
  return {
    enabled: false,
    includePhotos: true,
    maxPhotos: 3,
    autoOpenBrowser: "default",
    discord: {
      allWebhookUrl: "",
      buyNowWebhookUrl: "",
      maybeWebhookUrl: "",
    },
  };
}

export function selectDiscordTargets() {
  return [];
}

export function buildDiscordEmbeds() {
  return [];
}

export async function notify(_record) {
  // no-op until Phase 3
}

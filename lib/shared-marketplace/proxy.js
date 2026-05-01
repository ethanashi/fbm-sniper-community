const SUPPORTED_PROXY_PROTOCOLS = new Set(["http", "https", "socks4", "socks5"]);

function hasScheme(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function defaultPort(protocol) {
  if (protocol === "https") return 443;
  if (protocol === "socks4" || protocol === "socks5") return 1080;
  return 8080;
}

function bracketHost(hostname) {
  return hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
}

function encodeAuth(value) {
  return encodeURIComponent(value);
}

function normalizeCandidate(value) {
  if (hasScheme(value)) return value;
  if (value.includes("@")) return `http://${value}`;

  const parts = value.split(":");
  if (parts.length >= 4 && /^\d+$/.test(parts[1])) {
    const [host, port, username, ...passwordParts] = parts;
    const password = passwordParts.join(":");
    return `http://${encodeAuth(username)}:${encodeAuth(password)}@${host}:${port}`;
  }

  return `http://${value}`;
}

export function normalizeProxyInput(raw) {
  const input = String(raw || "").trim();
  if (!input) return null;

  let url;
  try {
    url = new URL(normalizeCandidate(input));
  } catch {
    return null;
  }

  const protocol = url.protocol.replace(":", "").toLowerCase();
  if (!SUPPORTED_PROXY_PROTOCOLS.has(protocol)) return null;

  const host = url.hostname;
  if (!host) return null;

  const port = url.port ? Number(url.port) : defaultPort(protocol);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;

  const username = url.username ? decodeURIComponent(url.username) : "";
  const password = url.password ? decodeURIComponent(url.password) : "";
  const hostPort = `${bracketHost(host)}:${port}`;
  const auth = username ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : "";

  return {
    input,
    protocol,
    host,
    port,
    username,
    password,
    server: `${protocol}://${hostPort}`,
    href: `${protocol}://${auth}${hostPort}`,
    label: username ? `${hostPort} (${protocol}, auth)` : `${hostPort} (${protocol})`,
  };
}

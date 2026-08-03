export type PrivyPublicConfig = {
  appId: string;
  clientId: string;
};

type PublicConfigResult =
  | { ok: true; value: PrivyPublicConfig }
  | { ok: false; missing: string[] };

/**
 * Read only public identifiers that are safe to embed in the mobile binary.
 *
 * Expo replaces direct `process.env.EXPO_PUBLIC_*` property reads at bundle
 * time, so do not convert this to dynamic object indexing. Provider secrets do
 * not belong here.
 */
export function readPrivyPublicConfig(): PublicConfigResult {
  const appId = process.env.EXPO_PUBLIC_PRIVY_APP_ID?.trim() ?? '';
  const clientId = process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID?.trim() ?? '';
  const missing: string[] = [];

  if (!appId) {
    missing.push('EXPO_PUBLIC_PRIVY_APP_ID');
  }

  if (!clientId) {
    missing.push('EXPO_PUBLIC_PRIVY_CLIENT_ID');
  }

  if (missing.length > 0) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    value: { appId, clientId },
  };
}

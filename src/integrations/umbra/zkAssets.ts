import { Directory, File, Paths } from 'expo-file-system';

export type UmbraCircuit =
  | 'userRegistration'
  | 'createDepositWithPublicAmount'
  | 'claimDepositIntoPublicAmount:n1';

export const UMBRA_RN_ZK_ASSET_VERSION = 'v5';
const MANIFEST_TIMEOUT_MS = 15_000;
const ASSET_DOWNLOAD_TIMEOUT_MS = 300_000;
export const UMBRA_ZKEY_SPECS: Record<
  UmbraCircuit,
  { readonly bytes: number; readonly path: string }
> = {
  userRegistration: {
    bytes: 30_957_712,
    path: `${UMBRA_RN_ZK_ASSET_VERSION}/zkey-wasm/userregistration.zkey`,
  },
  createDepositWithPublicAmount: {
    bytes: 4_042_884,
    path: `${UMBRA_RN_ZK_ASSET_VERSION}/zkey-wasm/createdepositwithpublicamount.zkey`,
  },
  'claimDepositIntoPublicAmount:n1': {
    bytes: 40_771_972,
    path: `${UMBRA_RN_ZK_ASSET_VERSION}/zkey-wasm/claimdepositintopublicamountn1.zkey`,
  },
};

type RemoteManifest = {
  readonly version?: unknown;
  readonly assets?: unknown;
};

type UmbraZkey = {
  readonly source: 'cache' | 'network';
  readonly uri: string;
};

const assetRequests = new Map<string, Promise<UmbraZkey>>();
const manifestRequests = new Map<string, Promise<void>>();

export class UmbraAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UmbraAssetError';
  }
}

export async function getUmbraZkey(
  baseUrl: string,
  circuit: UmbraCircuit,
  options?: { readonly refresh?: boolean },
): Promise<UmbraZkey> {
  if (options?.refresh === true) {
    return loadUmbraZkey(baseUrl, circuit, true);
  }

  const key = `${baseUrl}:${circuit}`;
  const existing = assetRequests.get(key);

  if (existing !== undefined) {
    return existing;
  }

  const request = loadUmbraZkey(baseUrl, circuit, false).finally(() => {
    if (assetRequests.get(key) === request) {
      assetRequests.delete(key);
    }
  });
  assetRequests.set(key, request);
  return request;
}

export async function prefetchUmbraZkey(
  baseUrl: string,
  circuit: UmbraCircuit,
): Promise<void> {
  try {
    await getUmbraZkey(baseUrl, circuit);
  } catch (cause) {
    console.warn('[Perpal Umbra proof]', JSON.stringify({
      circuit,
      errorName: cause instanceof Error ? cause.name : typeof cause,
      event: 'asset_prefetch_failed',
    }));
  }
}

async function loadUmbraZkey(
  baseUrl: string,
  circuit: UmbraCircuit,
  refresh: boolean,
): Promise<UmbraZkey> {
  const asset = UMBRA_ZKEY_SPECS[circuit];
  const manifestStartedAtMs = performance.now();
  await verifyManifestOnce(baseUrl, circuit, asset.path);
  console.info('[Perpal Umbra proof]', JSON.stringify({
    circuit,
    durationMs: Math.round(performance.now() - manifestStartedAtMs),
    event: 'manifest_verified',
    manifestVersion: UMBRA_RN_ZK_ASSET_VERSION,
  }));
  const assetStartedAtMs = performance.now();

  const directory = new Directory(
    Paths.document,
    `perpal-umbra-zk-${UMBRA_RN_ZK_ASSET_VERSION}`,
  );
  const file = new File(directory, asset.path.split('/').at(-1) ?? 'asset.zkey');

  if (refresh && file.exists) {
    await file.delete();
  }

  if (file.exists && file.size === asset.bytes) {
    logAssetReady(circuit, asset.bytes, 'cache', assetStartedAtMs);
    return { source: 'cache', uri: file.uri };
  }

  if (!directory.exists) {
    await directory.create({ intermediates: true });
  }

  if (file.exists) {
    await file.delete();
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    ASSET_DOWNLOAD_TIMEOUT_MS,
  );

  try {
    await File.downloadFileAsync(`${baseUrl}/${asset.path}`, file, {
      signal: controller.signal,
    });
  } catch (cause) {
    if (file.exists) {
      await file.delete();
    }
    throw controller.signal.aborted
      ? new UmbraAssetError('Umbra proving asset download timed out.')
      : cause;
  } finally {
    clearTimeout(timeout);
  }

  if (!file.exists || file.size !== asset.bytes) {
    if (file.exists) {
      await file.delete();
    }
    throw new UmbraAssetError('Umbra proving asset failed its byte-count check.');
  }

  logAssetReady(circuit, asset.bytes, 'network', assetStartedAtMs);
  return { source: 'network', uri: file.uri };
}

async function verifyManifestOnce(
  baseUrl: string,
  circuit: UmbraCircuit,
  expectedPath: string,
): Promise<void> {
  const key = `${baseUrl}:${UMBRA_RN_ZK_ASSET_VERSION}:${circuit}`;
  const existing = manifestRequests.get(key);

  if (existing !== undefined) {
    return existing;
  }

  const request = verifyManifest(baseUrl, circuit, expectedPath).catch((cause) => {
    if (manifestRequests.get(key) === request) {
      manifestRequests.delete(key);
    }
    throw cause;
  });
  manifestRequests.set(key, request);
  return request;
}

function logAssetReady(
  circuit: UmbraCircuit,
  bytes: number,
  source: 'cache' | 'network',
  startedAtMs: number,
): void {
  console.info('[Perpal Umbra proof]', JSON.stringify({
    bytes,
    circuit,
    durationMs: Math.round(performance.now() - startedAtMs),
    event: 'asset_ready',
    manifestVersion: UMBRA_RN_ZK_ASSET_VERSION,
    source,
  }));
}

async function verifyManifest(
  baseUrl: string,
  circuit: UmbraCircuit,
  expectedPath: string,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(
      `${baseUrl}/${UMBRA_RN_ZK_ASSET_VERSION}/manifest.json?t=${Date.now()}`,
      { signal: controller.signal },
    );
  } catch (cause) {
    throw controller.signal.aborted
      ? new UmbraAssetError('Umbra proving manifest request timed out.')
      : cause;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new UmbraAssetError('Umbra proving manifest is unavailable.');
  }

  const manifest = (await response.json()) as RemoteManifest;

  if (manifest.version !== UMBRA_RN_ZK_ASSET_VERSION) {
    throw new UmbraAssetError(
      'Umbra changed its proving-asset version; this build must be reviewed.',
    );
  }

  const path = manifestPath(manifest.assets, circuit);

  if (path !== expectedPath) {
    throw new UmbraAssetError(
      'Umbra proving manifest does not match the reviewed asset set.',
    );
  }
}

function manifestPath(assets: unknown, circuit: UmbraCircuit): string | null {
  if (typeof assets !== 'object' || assets === null || Array.isArray(assets)) {
    return null;
  }

  const root = assets as Record<string, unknown>;
  const [name, variant] = circuit.split(':');
  const entry = root[name ?? ''];
  const selected = variant === undefined
    ? entry
    : typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      ? (entry as Record<string, unknown>)[variant]
      : null;

  if (typeof selected !== 'object' || selected === null || Array.isArray(selected)) {
    return null;
  }

  const path = (selected as Record<string, unknown>).url;
  const version = (selected as Record<string, unknown>).version;

  return typeof path === 'string' && version === UMBRA_RN_ZK_ASSET_VERSION
    ? path
    : null;
}

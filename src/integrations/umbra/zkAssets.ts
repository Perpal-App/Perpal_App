import { Directory, File, Paths } from 'expo-file-system';

export type UmbraCircuit =
  | 'userRegistration'
  | 'createDepositWithPublicAmount'
  | 'claimDepositIntoPublicAmount:n1';

export const UMBRA_RN_ZK_ASSET_VERSION = 'v5';
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
): Promise<{ readonly source: 'cache' | 'network'; readonly uri: string }> {
  const asset = UMBRA_ZKEY_SPECS[circuit];
  await verifyManifest(baseUrl, circuit, asset.path);

  const directory = new Directory(
    Paths.document,
    `perpal-umbra-zk-${UMBRA_RN_ZK_ASSET_VERSION}`,
  );
  const file = new File(directory, asset.path.split('/').at(-1) ?? 'asset.zkey');

  if (options?.refresh === true && file.exists) {
    await file.delete();
  }

  if (file.exists && file.size === asset.bytes) {
    logAssetReady(circuit, asset.bytes, 'cache');
    return { source: 'cache', uri: file.uri };
  }

  if (!directory.exists) {
    await directory.create({ intermediates: true });
  }

  if (file.exists) {
    await file.delete();
  }

  await File.downloadFileAsync(`${baseUrl}/${asset.path}`, file);

  if (!file.exists || file.size !== asset.bytes) {
    if (file.exists) {
      await file.delete();
    }
    throw new UmbraAssetError('Umbra proving asset failed its byte-count check.');
  }

  logAssetReady(circuit, asset.bytes, 'network');
  return { source: 'network', uri: file.uri };
}

function logAssetReady(
  circuit: UmbraCircuit,
  bytes: number,
  source: 'cache' | 'network',
): void {
  console.info('[Perpal Umbra proof]', JSON.stringify({
    bytes,
    circuit,
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
  const response = await fetch(
    `${baseUrl}/${UMBRA_RN_ZK_ASSET_VERSION}/manifest.json?t=${Date.now()}`,
  );

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

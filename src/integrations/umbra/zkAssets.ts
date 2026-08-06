import { Directory, File, Paths } from 'expo-file-system';

export type UmbraCircuit =
  | 'createDepositWithPublicAmount'
  | 'claimDepositIntoPublicAmount:n1';

const PINNED_MANIFEST_VERSION = 'v3';
const ASSETS: Record<
  UmbraCircuit,
  { readonly bytes: number; readonly path: string }
> = {
  createDepositWithPublicAmount: {
    bytes: 4_042_884,
    path: 'v3/zkey-wasm/createdepositwithpublicamount.zkey',
  },
  'claimDepositIntoPublicAmount:n1': {
    bytes: 59_669_640,
    path: 'v3/zkey-wasm/claimdepositintopublicamountn1.zkey',
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
): Promise<string> {
  const asset = ASSETS[circuit];
  await verifyManifest(baseUrl, circuit, asset.path);

  const directory = new Directory(Paths.document, 'perpal-umbra-zk-v3');
  const file = new File(directory, asset.path.split('/').at(-1) ?? 'asset.zkey');

  if (file.exists && file.size === asset.bytes) {
    return file.uri;
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

  return file.uri;
}

async function verifyManifest(
  baseUrl: string,
  circuit: UmbraCircuit,
  expectedPath: string,
): Promise<void> {
  const response = await fetch(`${baseUrl}/manifest.json?t=${Date.now()}`);

  if (!response.ok) {
    throw new UmbraAssetError('Umbra proving manifest is unavailable.');
  }

  const manifest = (await response.json()) as RemoteManifest;

  if (manifest.version !== PINNED_MANIFEST_VERSION) {
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

  return typeof path === 'string' && version === PINNED_MANIFEST_VERSION
    ? path
    : null;
}

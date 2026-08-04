// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// Venue isolation is enforced here rather than left to code review.
//
// Devnet trades on Drift, mainnet trades on Flash. They are separate protocols
// with separate SDKs and separate pinned web3.js copies, so the only place either
// SDK may be imported is its own adapter directory. Everything above the adapter
// boundary talks to the `PerpsVenue` port, which means a devnet build cannot
// accidentally reach mainnet code and vice versa.
const DRIFT_SDK = ['@drift-labs/*'];
const FLASH_SDK = ['@flash_trade/*'];
const UMBRA_SDK = ['@umbra-privacy/*'];
const MAGICBLOCK_SDK = ['@magicblock-labs/*'];
const SOLANA_SDK = ['@solana/web3.js', '@solana/kit', '@coral-xyz/*'];

const PROTOCOL_SDKS = [
  ...DRIFT_SDK,
  ...FLASH_SDK,
  ...UMBRA_SDK,
  ...MAGICBLOCK_SDK,
  ...SOLANA_SDK,
];

const restrict = (patterns, message) => ({
  'no-restricted-imports': ['error', { patterns: patterns.map((group) => ({ group: [group], message })) }],
});

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'dist/*',
      'ios/*',
      'android/*',
      'perpal_docs_gitignore_it/*',
      'assets/*',
    ],
  },

  // Screens, domain logic, and shared components must stay venue-agnostic.
  {
    files: ['src/features/**', 'src/domain/**', 'src/components/**', 'app/**'],
    rules: restrict(
      PROTOCOL_SDKS,
      'Protocol SDKs may only be imported inside their own adapter under src/integrations/. Depend on the PerpsVenue port instead.',
    ),
  },

  // The Drift adapter may not reach into Flash, and vice versa. Neither may
  // import the other's SDK, which is what keeps the two builds disjoint.
  {
    files: ['src/integrations/perps/drift/**'],
    rules: restrict(
      [...FLASH_SDK, 'src/integrations/perps/flash/**', '@/integrations/perps/flash/**'],
      'The Drift devnet adapter must not reference Flash. Venue adapters are mutually isolated.',
    ),
  },
  {
    files: ['src/integrations/perps/flash/**'],
    rules: restrict(
      [...DRIFT_SDK, 'src/integrations/perps/drift/**', '@/integrations/perps/drift/**'],
      'The Flash mainnet adapter must not reference Drift. Venue adapters are mutually isolated.',
    ),
  },

  // The port defines the contract, so it must not depend on any implementation.
  {
    files: ['src/integrations/perps/venue/**'],
    rules: restrict(
      [...PROTOCOL_SDKS, '@/integrations/perps/drift/**', '@/integrations/perps/flash/**'],
      'The PerpsVenue port must stay free of SDK and adapter imports.',
    ),
  },

  // Tests may import adapters but not hardcode endpoints; config comes from env.
  {
    files: ['tests/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value=/^https?:\\/\\/(?!localhost|127\\.0\\.0\\.1)/]",
          message:
            'Do not hardcode remote URLs in tests. Use fixtures or injected config.',
        },
      ],
    },
  },
]);

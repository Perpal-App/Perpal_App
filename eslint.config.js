// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const FLASH_SDK = ['@flash_trade/*'];
const UMBRA_SDK = ['@umbra-privacy/*'];
const MAGICBLOCK_SDK = ['@magicblock-labs/*'];
const SOLANA_SDK = ['@solana/web3.js', '@solana/kit', '@coral-xyz/*'];

const PROTOCOL_SDKS = [
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

  // Tests must not point at real remote services. Loopback is fine, and so are
  // RFC 2606 reserved names (`*.example`, `example.com`), which exist precisely to
  // be unroutable fixtures — a URL-handling test has to be given URLs.
  {
    files: ['tests/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "Literal[value=/^https?:\\/\\/(?!localhost|127\\.0\\.0\\.1)(?![^\\/]*example)/]",
          message:
            'Do not point tests at a real remote host. Use localhost or an *.example fixture host.',
        },
      ],
    },
  },
]);

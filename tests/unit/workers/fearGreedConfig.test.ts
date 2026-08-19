import { resolveFearGreedUrl } from '../../../workers/gateway/src/env';

it('accepts the configured public Fear and Greed query without accepting fragments', () => {
  const url = 'https://api.alternative.me/fng/?limit=1&format=json';

  expect(resolveFearGreedUrl({ FEAR_GREED_URL: url })).toBe(url);
  expect(() => resolveFearGreedUrl({ FEAR_GREED_URL: `${url}#secret` })).toThrow(
    'FEAR_GREED_URL',
  );
});

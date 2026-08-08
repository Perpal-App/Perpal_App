import { parsePublicMarketBriefing } from '../../../workers/gateway/src/marketBriefing';

it('normalizes public RSS news and upcoming high-impact U.S. events', () => {
  const now = Date.parse('2026-08-08T12:00:00Z');
  const rss = (title: string, url: string, description: string) => `
    <rss><channel><item>
      <title><![CDATA[${title}]]></title>
      <link>${url}</link>
      <description><![CDATA[${description}]]></description>
      <pubDate>Sat, 08 Aug 2026 11:00:00 GMT</pubDate>
    </item></channel></rss>`;
  const result = parsePublicMarketBriefing(
    rss('Crypto derivatives volume rises', 'https://example.com/perps', 'Perpetual futures markets move.'),
    rss('Stocks rise after earnings', 'https://example.com/stocks', 'U.S. shares advanced.'),
    rss('FOMC issues its statement', 'https://example.com/fed', 'Monetary policy update.'),
    {
      data_quality: { is_official: true, is_stale: false },
      data: [
        {
          announcement_datetime: Date.parse('2026-08-12T12:30:00Z') / 1_000,
          event_importance: 'high',
          name: 'CPI Inflation Rate YoY',
        },
        {
          announcement_datetime: Date.parse('2026-08-13T12:30:00Z') / 1_000,
          event_importance: 'low',
          name: 'Initial Jobless Claims',
        },
      ],
    },
    now,
  );

  expect(result.news.map((article) => article.category)).toEqual([
    'perps',
    'markets',
    'fed',
  ]);
  expect(result.events).toEqual([{
    actual: null,
    estimate: null,
    event: 'CPI Inflation Rate YoY',
    previous: null,
    scheduledAtMs: Date.parse('2026-08-12T12:30:00Z'),
    unit: null,
  }]);
});

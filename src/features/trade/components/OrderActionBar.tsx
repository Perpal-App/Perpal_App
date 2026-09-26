import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useRetainedValue } from '@/components/motion/useRetainedValue';
import { ActionButton } from '@/components/ui/ActionButton';
import { DraggableSheet } from '@/components/ui/DraggableSheet';
import { ProgressiveBlur } from '@/components/ui/ProgressiveBlur';
import { readAppConfig } from '@/config/appConfig';
import { usePageMoving } from '@/navigation/tabs/minimizeState';
import { PacificaOrderTicket } from '@/features/trade/components/orderTicket/PacificaOrderTicket';
import type { PacificaOrderSide } from '@/integrations/perps/pacifica/pacificaOrder';
import type {
  PacificaMarket,
  PacificaMarketSnapshot,
} from '@/integrations/perps/pacifica/pacificaMarketData';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

/**
 * How long after the bar appears it declines to act.
 *
 * The case it answers is specific and easy to hit: the markets table's rows are full width, so a row
 * near the bottom of that list sits exactly where these buttons land on the screen it opens. A second
 * touch from an impatient double-tap arrives on `Buy / Long`. Roughly the length of the screen
 * transition, so the button is barely on screen for any of it.
 */
const ARM_DELAY_MS = 350;

/** Height of the two actions plus the band the blur fades across. */
const BAR_HEIGHT = 52;
const BLUR_RUN_UP = spacing.xl;
const BAR_BASE_PAD = spacing.xs;

/**
 * Vertical space the floating bar occupies.
 *
 * Screens that mount this as an overlay add it to their content's bottom padding, so the last row
 * clears the buttons instead of ending underneath them — the same contract `TAB_BAR_CLEARANCE` has with
 * the tab pill, and for the same reason: chrome that floats over content cannot reserve the space.
 */
export const ORDER_BAR_CLEARANCE = BLUR_RUN_UP + BAR_HEIGHT + BAR_BASE_PAD;

/**
 * The app's only way into an order.
 *
 * Both the buttons and the ticket they open live here, so a screen cannot grow a second order form of
 * its own: it mounts this bar, and every order in the app starts from the same two controls and
 * finishes in the same ticket.
 *
 * The ticket opens as a card from the bottom rather than inline. Order entry is a task, not part of the
 * page, and a sheet keeps the chart and the market's figures on screen behind it while the ticket has
 * focus. It is the same object as the deposit and withdraw cards on the portfolio screen — grabber,
 * drag to expand, drag down to close — because a buy should not feel like a different kind of
 * transaction from a deposit.
 *
 * That sheet used to be private to this file and was the weakest of the app's three: the platform's
 * `animationType="slide"`, a grabber that was pure decoration with no gesture behind it, a fixed
 * `maxHeight: '88%'`, and no keyboard avoidance at all — which on a form of five numeric fields meant
 * the keyboard covered the thing being typed into. It now uses the shared `DraggableSheet`.
 *
 * `side` is chosen here and fixed for the ticket's life. The ticket used to repeat the choice as its own
 * Buy/Sell pair, which asked the reader a question they had just answered; now the side is the button
 * they pressed, and changing it means closing the ticket and pressing the other one. Each open mounts a
 * fresh ticket, so a plan priced for one side can never be signable on the other.
 */
export function OrderActionBar({
  market,
  snapshot,
}: {
  readonly market: PacificaMarket;
  readonly snapshot: PacificaMarketSnapshot | null;
}) {
  const config = readAppConfig();
  const router = useRouter();
  const moving = usePageMoving();
  const [side, setSide] = useState<PacificaOrderSide | null>(null);
  // The side the ticket was opened for, kept after it is closed so the ticket is still in the sheet while
  // the sheet slides away. Dropping it with `side` emptied the sheet on the first frame of every close.
  const shownSide = useRetainedValue(side);
  // Set on first render, so it is the moment the bar appeared rather than the moment the screen
  // mounted. See `ARM_DELAY_MS`.
  const armedAt = useRef(Date.now() + ARM_DELAY_MS);

  /**
   * Opens the ticket, unless the touch looks accidental.
   *
   * Two refusals, and both exist because this floats over a scroller. A control up here never gets the
   * cancellation an in-scroll control gets for free — the touch does not reach the scroll view at all,
   * so there is nothing to lose the press to.
   *
   * Silent rather than explained. A tap the reader did not mean to make has no message worth showing
   * for it; the honest response is that nothing happens.
   */
  const open = (next: PacificaOrderSide) => {
    if (Date.now() < armedAt.current) return;
    if (moving.value) return;
    setSide(next);
  };

  /**
   * Leaves for the funding flow, which lives on the portfolio screen because it takes minutes and has
   * its own resumable state — not something to run inside an order ticket.
   *
   * Routed rather than mounted. Presenting the funding sheet here would mean importing the portfolio's
   * `FundsSheet` and its four data dependencies into the trade feature, and the router is the cheaper
   * seam: the param is an intent, and the portfolio screen decides what to do with it.
   *
   * `navigate`, not `push` — the destination is a tab, and pushing one grows a stack the back gesture
   * then has to unwind.
   */
  const requestFunding = () => {
    setSide(null);
    router.navigate({ params: { funds: 'deposit' }, pathname: '/(tabs)/portfolio' });
  };
  // Trading needs a current mark and a valid build: without either the buttons stay visible but inert
  // rather than opening a ticket that cannot price.
  const tradable = snapshot !== null && config.ok;

  return (
    <View pointerEvents="box-none" style={styles.bar}>
      {/* The only thing behind the buttons, and it is not a container: no fill, no rim, no corners.
          The same progressive blur the tab pill floats on, anchored to the bottom so it is thickest
          under the actions and gone by the top of the band — content scrolling past stays visible and
          stays legible under the labels. It takes no touches, so the page is still scrollable in the
          gaps between and around the two buttons. */}
      <ProgressiveBlur direction="bottom" style={StyleSheet.absoluteFill} />

      {tradable ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.blocked}>
          {config.ok ? 'Waiting for a current Pacifica mark' : 'Market configuration unavailable'}
        </Text>
      )}

      <View style={styles.actions}>
        <ActionButton
          accessibilityHint="Opens the order ticket on this side"
          disabled={!tradable}
          glow
          gooey
          label="Buy / Long"
          onPress={() => open('long')}
          radius={radii.md}
          size="large"
          style={styles.action}
          tone="positive"
        />
        <ActionButton
          accessibilityHint="Opens the order ticket on this side"
          disabled={!tradable}
          glow
          gooey
          label="Sell / Short"
          onPress={() => open('short')}
          radius={radii.md}
          size="large"
          style={styles.action}
          tone="negative"
        />
      </View>

      {/* `restRatio={1}`: the ticket opens at the full height of the dock rather than at the sheet's
          half-screen default. Its keypad and action live at the bottom, and at half height they began
          below the fold — reachable only by dragging, because the card's box was taller than the part of
          it on screen and so the body's own scroll could not reach them either.

          Still one flat number taken from the host alone, which is the part that has to stay true. What
          made this sheet stick was a resting height derived from the *content*: the ticket's height
          changes as the balance loads, so a position that followed it was being computed against a
          measurement that had not settled. A share of the host cannot have that problem — at `1` it is
          the same value the drag's expanded target already springs to, so the sheet gains no position
          it did not already have.

          `fillBody` lets the ticket pin its keypad and action to the bottom of the sheet, under the thumb,
          which only makes sense because the sheet opens at full height.

          The title is the instrument alone. It used to carry the side as well, which contradicted the
          body whenever the account had nothing credited: a sheet headed `Buy / Long` over a deposit
          form. The side is carried by the ticket's own action instead — `Review long` — which is right
          in the one state the title would be wrong in, because the deposit form has its own action. */}
      <DraggableSheet
        closeLabel="Close order ticket"
        fillBody
        onClose={() => setSide(null)}
        restRatio={1}
        title={`${market.baseAsset}-USD`}
        visible={side !== null && tradable}
      >
        {/* Keyed by side, so opening the other side is always a fresh ticket — never this one with its
            side swapped under a plan priced for the first. The sheet unmounts it once it has gone. */}
        {shownSide !== null && snapshot !== null && config.ok ? (
          <PacificaOrderTicket
            key={shownSide}
            apiOrigin={config.value.perps.pacificaApiOrigin}
            centralState={config.value.perps.pacificaCentralState}
            market={market}
            onRequestFunding={requestFunding}
            programId={config.value.perps.pacificaProgramId}
            rpcUrl={config.value.api.rpcUrl}
            side={shownSide}
            snapshot={snapshot}
            usdcMint={config.value.perps.usdcMint}
            vault={config.value.perps.pacificaVault}
          />
        ) : null}
      </DraggableSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  // No fill, no rule and no corners — the blur behind is the whole background. The top padding is the
  // band the blur fades across rather than breathing room: without it the ramp would have only the
  // button's own height to get from full strength to nothing, and the top of it would read as an edge.
  bar: {
    gap: spacing.xs,
    paddingHorizontal: layout.screenPadding,
    paddingTop: BLUR_RUN_UP,
    paddingBottom: BAR_BASE_PAD,
  },
  blocked: { ...typography.caption, color: colors.textMuted },
  actions: { flexDirection: 'row', gap: spacing.sm },
  // Width only. The lift is `ActionButton`'s `glow`, which throws each side's own colour and is what
  // separates these from the content scrolling past underneath.
  //
  // It used to be a dark shadow declared here, and it never drew on iOS: it sat on the same view as
  // the `overflow: 'hidden'` that clipped the fill to its corners, and a masked layer casts no shadow.
  // Moving it into the primitive put it on a layer that does not clip.
  action: { flex: 1 },
});

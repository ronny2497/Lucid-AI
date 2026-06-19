/**
 * EventRow — one HSC event rendered with its type, principle badge, and
 * quadrant.x / quadrant.y badges, plus its attribute bag.
 *
 * Honest absence (D-05 / T-01-14): when `quadrant.y` is null we NEVER fabricate
 * a value. For event types whose y is emitter-specified (currently
 * `feedback.check`, per `EMITTER_SPECIFIED_Y`) a missing y is a meaningful gap,
 * so we render an explicit "absent" badge. For intentionally-untagged actions
 * (tool.call, error) we render a neutral "—" so the two cases stay
 * distinguishable. The same applies to a mutating tool.call without a paired
 * verify.result — the gap is shown, not papered over.
 *
 * XSS guard (T-01-13): every attribute value is rendered through JSX text only.
 * No raw-HTML injection prop is used anywhere — a stored `<b>` shows as the
 * literal characters, never as live DOM.
 */

import { EMITTER_SPECIFIED_Y, type HscEventType } from "@lucid/hsc-schema";
import type { HarnessEvent } from "../api/types.js";
import { attrToText, formatDurationNs, statusLabel } from "../lib/format.js";
import { Badge } from "./Badge.js";

function durationOf(event: HarnessEvent): number | null {
  return event.endTime !== null ? event.endTime - event.startTime : null;
}

function YQuadrantBadge({ event }: { event: HarnessEvent }) {
  if (event.quadrantY !== null && event.quadrantY !== undefined) {
    return (
      <Badge variant="quadrant" title="quadrant.y">
        y: {event.quadrantY}
      </Badge>
    );
  }
  // y is null — decide whether this is an honest absence or an untagged action.
  const emitterSpecified = EMITTER_SPECIFIED_Y.has(
    event.eventType as HscEventType,
  );
  if (emitterSpecified) {
    return (
      <Badge
        variant="absent"
        title="quadrant.y was not tagged by the emitter (honest absence, D-05)"
      >
        y: absent
      </Badge>
    );
  }
  return (
    <Badge variant="muted" title="quadrant.y is intentionally untagged">
      y: —
    </Badge>
  );
}

function XQuadrantBadge({ event }: { event: HarnessEvent }) {
  if (event.quadrantX !== null && event.quadrantX !== undefined) {
    return (
      <Badge variant="quadrant" title="quadrant.x">
        x: {event.quadrantX}
      </Badge>
    );
  }
  return (
    <Badge variant="muted" title="quadrant.x is intentionally untagged">
      x: —
    </Badge>
  );
}

export function EventRow({ event }: { event: HarnessEvent }) {
  const attrEntries = Object.entries(event.attrs ?? {});
  return (
    <li className="event-row" data-event-type={event.eventType}>
      <div className="event-row-head">
        <span className="event-type">{event.eventType}</span>
        {event.principle !== null ? (
          <Badge variant="principle" title="harness.principle">
            {event.principle}
          </Badge>
        ) : (
          <Badge variant="muted" title="no principle">
            no principle
          </Badge>
        )}
        <XQuadrantBadge event={event} />
        <YQuadrantBadge event={event} />
        <Badge variant={event.statusCode === 2 ? "error" : "ok"}>
          {statusLabel(event.statusCode)}
        </Badge>
        <span className="event-duration">{formatDurationNs(durationOf(event))}</span>
      </div>
      {attrEntries.length > 0 && (
        <dl className="event-attrs">
          {attrEntries.map(([key, value]) => (
            <div key={key} className="event-attr">
              {/* JSX text only — escaped by React; no raw-HTML injection. */}
              <dt className="event-attr-key">{key}</dt>
              <dd className="event-attr-val">{attrToText(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

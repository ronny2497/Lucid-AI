/**
 * A minimal shadcn/ui-style Badge primitive (copy-paste, no runtime dep).
 *
 * Variants map to small visual tones. The "absent" variant is reserved for
 * honest-absence markers (a missing quadrant.y) so a developer can distinguish
 * "the emitter did not tag this" from a real value at a glance (D-05).
 */

import type { ReactNode } from "react";

export type BadgeVariant =
  | "default"
  | "principle"
  | "quadrant"
  | "absent"
  | "ok"
  | "error"
  | "muted";

export function Badge({
  variant = "default",
  children,
  title,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge badge-${variant}`} title={title} data-variant={variant}>
      {children}
    </span>
  );
}

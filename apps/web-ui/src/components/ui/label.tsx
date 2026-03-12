import { forwardRef, type LabelHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

/**
 * Form label component.
 *
 * Styled label element with consistent typography and disabled-peer
 * support. Based on the shadcn/ui Label component.
 */
const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn(
          "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
          className,
        )}
        {...props}
      />
    );
  },
);
Label.displayName = "Label";

export { Label };

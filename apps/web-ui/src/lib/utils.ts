import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with deduplication and conflict resolution.
 *
 * Combines `clsx` (conditional class composition) with `tailwind-merge`
 * (Tailwind-specific class deduplication). This is the standard shadcn/ui
 * utility used by all UI components.
 *
 * @param inputs - Class values to merge (strings, arrays, objects, etc.)
 * @returns Merged and deduplicated class string
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

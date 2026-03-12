import { useCallback, useState, useEffect } from "react";
import { Button } from "../../../components/ui/button.js";
import { Textarea } from "../../../components/ui/textarea.js";
import { cn } from "../../../lib/utils.js";

/**
 * Props for the {@link JsonEditor} component.
 */
export interface JsonEditorProps {
  /** Current JSON value as a string. */
  readonly value: string;
  /** Callback invoked when the JSON text changes. */
  readonly onChange: (value: string) => void;
  /** Optional label displayed above the editor. */
  readonly label?: string;
  /** Whether the editor is read-only. */
  readonly readOnly?: boolean;
  /** Minimum height of the textarea in pixels. */
  readonly minHeight?: number;
  /** data-testid attribute for testing. */
  readonly "data-testid"?: string;
}

/**
 * Attempts to parse a JSON string and returns the validation result.
 *
 * @param text - The JSON string to validate.
 * @returns An object with `valid` boolean and optional `error` message.
 */
export function validateJson(text: string): { valid: boolean; error?: string } {
  if (text.trim() === "" || text.trim() === "null") {
    return { valid: true };
  }
  try {
    JSON.parse(text);
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Invalid JSON",
    };
  }
}

/**
 * Formats a JSON string with 2-space indentation.
 *
 * Returns the original string if parsing fails.
 *
 * @param text - The JSON string to format.
 * @returns Formatted JSON string or the original on parse failure.
 */
export function formatJson(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

/**
 * JSON editor component with validation and formatting.
 *
 * Provides a textarea-based JSON editor with real-time validation,
 * formatting button, and visual feedback for invalid JSON. Designed
 * for editing policy configuration objects in the config editor.
 *
 * @see T099 — Build configuration editor view
 */
export function JsonEditor({
  value,
  onChange,
  label,
  readOnly = false,
  minHeight = 200,
  "data-testid": testId,
}: JsonEditorProps) {
  const [validation, setValidation] = useState<{ valid: boolean; error?: string }>({ valid: true });

  useEffect(() => {
    setValidation(validateJson(value));
  }, [value]);

  const handleFormat = useCallback(() => {
    if (validation.valid && value.trim() !== "") {
      onChange(formatJson(value));
    }
  }, [value, onChange, validation.valid]);

  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="flex items-center justify-between">
        {label && <label className="text-sm font-medium leading-none">{label}</label>}
        <div className="flex items-center gap-2">
          {!validation.valid && (
            <span
              className="text-xs text-destructive"
              data-testid={testId ? `${testId}-error` : "json-error"}
            >
              {validation.error}
            </span>
          )}
          {!readOnly && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleFormat}
              disabled={!validation.valid || value.trim() === ""}
              data-testid={testId ? `${testId}-format` : "json-format"}
            >
              Format
            </Button>
          )}
        </div>
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        className={cn(
          "font-mono text-xs",
          !validation.valid && "border-destructive focus-visible:ring-destructive",
        )}
        style={{ minHeight }}
        data-testid={testId ? `${testId}-textarea` : "json-textarea"}
      />
    </div>
  );
}

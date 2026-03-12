// @vitest-environment jsdom
/**
 * Tests for the JsonEditor component and JSON utility functions.
 *
 * Validates the textarea-based JSON editor:
 * - validateJson correctly identifies valid and invalid JSON
 * - formatJson prettifies JSON with 2-space indentation
 * - Component renders with label and textarea
 * - Validation errors displayed for invalid JSON
 * - Format button formats valid JSON
 * - Read-only mode disables editing and hides format button
 *
 * The JSON editor is a core building block of the config editor,
 * used for all policy and pool JSON fields.
 *
 * @see T099 — Build configuration editor view
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { JsonEditor, validateJson, formatJson } from "./json-editor.js";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// validateJson tests
// ---------------------------------------------------------------------------

describe("validateJson", () => {
  /**
   * Valid JSON object should pass validation. This is the most common
   * use case for policy JSON fields.
   */
  it("returns valid for a correct JSON object", () => {
    const result = validateJson('{"key": "value"}');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  /**
   * Valid JSON array should pass validation. Capabilities fields
   * are stored as arrays.
   */
  it("returns valid for a correct JSON array", () => {
    const result = validateJson('["a", "b"]');
    expect(result.valid).toBe(true);
  });

  /**
   * The string "null" is a valid JSON value representing an empty
   * policy field. Must pass validation.
   */
  it("returns valid for null string", () => {
    const result = validateJson("null");
    expect(result.valid).toBe(true);
  });

  /**
   * Empty string is treated as valid (no content to validate).
   * Allows clearing a field without seeing an error.
   */
  it("returns valid for empty string", () => {
    const result = validateJson("");
    expect(result.valid).toBe(true);
  });

  /**
   * Invalid JSON must be rejected with an error message so the
   * operator knows the input cannot be saved.
   */
  it("returns invalid with error for malformed JSON", () => {
    const result = validateJson("{invalid json}");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  /**
   * Trailing commas are not valid JSON and must be rejected.
   * This is a common editing mistake.
   */
  it("returns invalid for trailing comma", () => {
    const result = validateJson('{"a": 1,}');
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatJson tests
// ---------------------------------------------------------------------------

describe("formatJson", () => {
  /**
   * Compact JSON should be formatted with 2-space indentation.
   * This is the primary formatting operation.
   */
  it("formats compact JSON with 2-space indentation", () => {
    const result = formatJson('{"a":1,"b":2}');
    expect(result).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  /**
   * Invalid JSON should be returned unchanged since it cannot
   * be parsed and re-serialized.
   */
  it("returns original string for invalid JSON", () => {
    const input = "{broken}";
    expect(formatJson(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// JsonEditor component tests
// ---------------------------------------------------------------------------

describe("JsonEditor", () => {
  /**
   * Verifies that the component renders with label and textarea.
   * This is the basic smoke test for the JSON editor.
   */
  it("renders label and textarea", () => {
    render(
      <JsonEditor
        value='{"key": "value"}'
        onChange={() => {}}
        label="Test Label"
        data-testid="test-editor"
      />,
    );

    expect(screen.getByText("Test Label")).toBeInTheDocument();
    expect(screen.getByTestId("test-editor-textarea")).toBeInTheDocument();
  });

  /**
   * Verifies that the textarea displays the provided value.
   * Data binding is critical for the editor to work correctly.
   */
  it("displays the provided value in the textarea", () => {
    render(<JsonEditor value='{"test": true}' onChange={() => {}} data-testid="editor" />);

    const textarea = screen.getByTestId("editor-textarea");
    expect(textarea).toHaveValue('{"test": true}');
  });

  /**
   * Verifies that onChange is called when the textarea value changes.
   * Without this, edits would not propagate to the parent form.
   */
  it("calls onChange when textarea is edited", () => {
    const onChange = vi.fn();
    render(<JsonEditor value='{"a": 1}' onChange={onChange} data-testid="editor" />);

    const textarea = screen.getByTestId("editor-textarea");
    fireEvent.change(textarea, { target: { value: '{"a": 2}' } });

    expect(onChange).toHaveBeenCalledWith('{"a": 2}');
  });

  /**
   * Verifies that validation error is shown for invalid JSON.
   * Visual feedback prevents operators from saving bad config.
   */
  it("shows validation error for invalid JSON", () => {
    render(<JsonEditor value="{invalid}" onChange={() => {}} data-testid="editor" />);

    expect(screen.getByTestId("editor-error")).toBeInTheDocument();
  });

  /**
   * Verifies that no error is shown for valid JSON.
   * Avoids false-positive error messages confusing operators.
   */
  it("does not show error for valid JSON", () => {
    render(<JsonEditor value='{"valid": true}' onChange={() => {}} data-testid="editor" />);

    expect(screen.queryByTestId("editor-error")).not.toBeInTheDocument();
  });

  /**
   * Verifies that the Format button calls onChange with prettified JSON.
   * Formatting improves readability of dense JSON policy objects.
   */
  it("formats JSON when Format button is clicked", () => {
    const onChange = vi.fn();
    render(<JsonEditor value='{"a":1,"b":2}' onChange={onChange} data-testid="editor" />);

    const formatBtn = screen.getByTestId("editor-format");
    fireEvent.click(formatBtn);

    expect(onChange).toHaveBeenCalledWith('{\n  "a": 1,\n  "b": 2\n}');
  });

  /**
   * Verifies that the Format button is disabled for invalid JSON.
   * Prevents parse errors from malformed input.
   */
  it("disables Format button for invalid JSON", () => {
    render(<JsonEditor value="{bad}" onChange={() => {}} data-testid="editor" />);

    const formatBtn = screen.getByTestId("editor-format");
    expect(formatBtn).toBeDisabled();
  });

  /**
   * Verifies that read-only mode hides the Format button and prevents editing.
   * Used in the Effective Config tab for display-only views.
   */
  it("hides Format button in read-only mode", () => {
    render(<JsonEditor value='{"a": 1}' onChange={() => {}} readOnly data-testid="editor" />);

    expect(screen.queryByTestId("editor-format")).not.toBeInTheDocument();
    expect(screen.getByTestId("editor-textarea")).toHaveAttribute("readonly");
  });
});

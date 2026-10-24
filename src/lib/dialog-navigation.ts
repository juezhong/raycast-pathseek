import path from "node:path";

/**
 * Dialog navigation is deliberately a text-only assisted workflow.
 * No AppleScript, Accessibility automation, keyboard injection, Finder
 * opening or Open/Save confirmation is performed here.
 *
 * With indexed file paths, the containing folder is the safest default
 * for macOS' native "Go to Folder" field. For folder results users can
 * instead paste the exact selected path through the secondary action.
 */
export function getDialogNavigationPaths(filepath: string): {
  containingFolder: string;
  selectedPath: string;
} {
  if (!path.isAbsolute(filepath) || filepath.includes("\0")) {
    throw new Error("Dialog navigation requires an absolute local path");
  }

  return { containingFolder: path.dirname(filepath), selectedPath: filepath };
}

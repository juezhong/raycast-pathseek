import { Action, ActionPanel, Detail, environment } from "@raycast/api";
import { useEffect, useState } from "react";
import path from "node:path";
import { AUTO_REBUILD_DAYS, isIndexStale, readIndex, type IndexMetadata } from "./lib/index-store";

type IndexState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ready"; metadata: IndexMetadata }
  | { status: "error"; message: string };

export default function IndexStatus() {
  const [state, setState] = useState<IndexState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    readIndex()
      .then((metadata) => {
        if (!active) return;
        setState(metadata ? { status: "ready", metadata } : { status: "empty" });
      })
      .catch((error: unknown) => {
        if (active) setState({ status: "error", message: String(error) });
      });
    return () => {
      active = false;
    };
  }, []);

  const directory = environment.supportPath;
  const metadataFile = path.join(directory, "index.json");

  const markdown =
    state.status === "loading"
      ? "# Index Status\n\nReading the saved index metadata…"
      : state.status === "empty"
        ? "# No Index\n\nRun **Rebuild Index** to generate your first persistent index."
        : state.status === "error"
          ? `# Index Error\n\n${state.message}\n\nCheck the index files, then use **Rebuild Index** to recover.`
          : `# Index Status\n\n- **Indexed paths:** ${state.metadata.count.toLocaleString()}\n- **Last built:** ${new Date(state.metadata.createdAt).toLocaleString()}\n- **Index file:** \`${state.metadata.filename}\`\n- **Search roots:**\n${state.metadata.roots.map((root) => `  - \`${root}\``).join("\n")}\n\nSearches reuse this index. An index at least ${AUTO_REBUILD_DAYS} days old is refreshed on the next Search Files launch (not while Raycast is closed).\\n\\n- **Refresh due:** ${isIndexStale(state.metadata) ? "Yes" : "No"}`;

  return (
    <Detail
      isLoading={state.status === "loading"}
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action.Open title="Open Index Directory in Finder" target={directory} />
          <Action.CopyToClipboard title="Copy Index Directory Path" content={directory} />
          <Action.CopyToClipboard title="Copy Metadata File Path" content={metadataFile} />
          {state.status === "ready" && (
            <Action.CopyToClipboard title="Copy Index Details" content={JSON.stringify(state.metadata, null, 2)} />
          )}
        </ActionPanel>
      }
    />
  );
}

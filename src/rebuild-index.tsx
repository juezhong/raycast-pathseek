import { Action, ActionPanel, Detail, Icon } from "@raycast/api";
import { useEffect, useState } from "react";
import { rebuildIndex, type IndexMetadata } from "./lib/index-store";

export default function RebuildIndex() {
  const [running, setRunning] = useState(true);
  const [result, setResult] = useState<IndexMetadata>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    // Rebuild Index 是单独的显式命令；普通 Search Files 不会调用 fd。
    rebuildIndex()
      .then((metadata) => { if (active) setResult(metadata); })
      .catch((failure: unknown) => { if (active) setError(String(failure)); })
      .finally(() => { if (active) setRunning(false); });
    return () => { active = false; };
  }, []);

  const markdown = error
    ? `# Rebuild Failed\n\n${error}\n\nThe previously published index remains available. Review your configured roots, exclusions, and the \`fd\` executable.`
    : result
      ? `# Index Rebuilt\n\n- **Paths:** ${result.count.toLocaleString()}\n- **Updated:** ${new Date(result.createdAt).toLocaleString()}\n- **Search Roots:**\n${result.roots.map((root) => `  - \`${root}\``).join("\n")}\n\nOpen **Search Files** to query this index. Rebuilding is manual only.`
      : "# Building Index\n\nScanning configured directories with `fd`. The existing index stays available while the new index is built.\n\nFor very large directories this may take some time.";

  return (
    <Detail
      isLoading={running}
      markdown={markdown}
      actions={
        result ? (
          <ActionPanel>
            <Action.CopyToClipboard title="Copy Index Summary" content={JSON.stringify(result, null, 2)} icon={Icon.CopyClipboard} />
          </ActionPanel>
        ) : undefined
      }
    />
  );
}

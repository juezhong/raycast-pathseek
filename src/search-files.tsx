import { Action, ActionPanel, Icon, List, showToast, Toast } from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import os from "node:os";
import path from "node:path";
import { fuzzySearch } from "./lib/fuzzy-search";
import { isIndexStale, readIndex, refreshExpiredIndex, type IndexMetadata } from "./lib/index-store";

export default function SearchFiles() {
  const [index, setIndex] = useState<IndexMetadata | null>();
  const [loadError, setLoadError] = useState<string>();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const autoRefreshAttempted = useRef(false);

  useEffect(() => {
    let active = true;
    readIndex()
      .then((data) => {
        if (active) setIndex(data);
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(String(error));
          setIndex(null);
        }
      });
    return () => { active = false; };
  }, []);

  // Only consider refresh ONCE when Search Files is opened, not per keystroke.
  // The existing index remains searchable while a new generation is built.
  useEffect(() => {
    if (!index || autoRefreshAttempted.current || !isIndexStale(index)) return;
    autoRefreshAttempted.current = true;
    let active = true;

    refreshExpiredIndex(index)
      .then((newIndex) => {
        if (active && newIndex) {
          setIndex(newIndex);
          void showToast({ style: Toast.Style.Success, title: "15-day index refresh completed" });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          console.warn("Automatic index refresh failed:", error);
          void showToast({
            style: Toast.Style.Failure,
            title: "Automatic index refresh failed",
            message: "The previous index is still available. Try Rebuild Index manually.",
          });
        }
      });

    return () => { active = false; };
  }, [index]);

  useEffect(() => {
    const controller = new AbortController();

    if (!index || !query.trim()) {
      setResults([]);
      setIsSearching(false);
      return () => controller.abort();
    }

    setResults([]);
    setLoadError(undefined);
    setIsSearching(true);

    const timer = setTimeout(() => {
      fuzzySearch(index, query, controller.signal)
        .then((paths) => {
          if (!controller.signal.aborted) setResults(paths);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setLoadError(String(error));
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsSearching(false);
        });
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [index, query]);

  const emptyTitle = loadError
    ? "Search Error"
    : index === undefined
      ? "Loading Index"
      : !index
        ? "No Index Yet"
        : !query.trim()
          ? "Type to Search"
          : "No Matching Files";

  const emptyDescription = loadError
    ? loadError
    : !index
      ? "Run Rebuild Index in Raycast to create the first local index."
      : !query.trim()
        ? "Indexed " + index.count.toLocaleString() + " paths on " + new Date(index.createdAt).toLocaleString() + "."
        : "Try a different pattern or rebuild the index to include new files.";

  return (
    <List
      isLoading={index === undefined || isSearching}
      filtering={false}
      searchBarPlaceholder="Search with fzf: filename, path, .pdf$, !node_modules…" 
      onSearchTextChange={setQuery}
    >
      <List.EmptyView title={emptyTitle} description={emptyDescription} icon={Icon.MagnifyingGlass} />
      {results.map((filepath) => {
        const display = filepath.startsWith(os.homedir() + path.sep)
          ? "~" + filepath.slice(os.homedir().length)
          : filepath;
        return (
          <List.Item
            key={filepath}
            title={path.basename(filepath)}
            subtitle={path.dirname(display)}
            icon={{ fileIcon: filepath }}
            quickLook={{ path: filepath, name: path.basename(filepath) }}
            actions={
              <ActionPanel>
                <Action.Open title="Open" target={filepath} />
                <Action.ShowInFinder title="Show in Finder" path={filepath} />
                <Action.Open title="Open Containing Folder" target={path.dirname(filepath)} />
                <Action.OpenWith path={filepath} shortcut={{ modifiers: ["cmd"], key: "o" }} />
                <Action.CopyToClipboard title="Copy Absolute Path" content={filepath} shortcut={{ modifiers: ["cmd"], key: "c" }} />
                <Action.ToggleQuickLook shortcut={{ modifiers: ["cmd"], key: "y" }} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

import {
  Action,
  ActionPanel,
  Icon,
  LaunchType,
  List,
  launchCommand,
  showToast,
  Toast,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fuzzySearch } from "./lib/fuzzy-search";
import { SearchAssistanceActions } from "./search-guides";
import {
  indexFilePath,
  readIndex,
  type IndexMetadata,
} from "./lib/index-store";
import {
  findIndexedDirectoryChoices,
  matchesSelectedDirectory,
  parseSubtreeQuery,
} from "./lib/subtree-search";
import { getDialogNavigationPaths } from "./lib/dialog-navigation";
import {
  getMissingBinary,
  missingBinaryMessage,
  HOMEBREW_INSTALL_COMMAND,
  HOMEBREW_URL,
} from "./lib/dependency-guide";

export function SearchFilesView({
  dialogMode = false,
}: {
  dialogMode?: boolean;
}) {
  const [index, setIndex] = useState<IndexMetadata | null>();
  const [loadError, setLoadError] = useState<string>();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeScope, setActiveScope] = useState<{
    expression: string;
    folder: string;
  } | null>(null);
  const [scopeHint, setScopeHint] = useState<{
    expression: string;
    selectedPath: string | null;
  } | null>(null);
  const [directoryChoices, setDirectoryChoices] = useState<string[]>([]);
  const [choicesTruncated, setChoicesTruncated] = useState(false);
  const [isLocatingDirectory, setIsLocatingDirectory] = useState(false);
  const [scopeError, setScopeError] = useState<string>();
  const queryRef = useRef("");
  const selectedPathRef = useRef<string | null>(null);

  let subtreeQuery: ReturnType<typeof parseSubtreeQuery> = null;
  let subtreeSyntaxError: string | undefined;
  try {
    subtreeQuery = parseSubtreeQuery(query);
  } catch (error) {
    subtreeSyntaxError = String(error);
  }
  const directoryExpression = subtreeQuery?.directoryExpression;
  const scopedFolder =
    subtreeQuery &&
    activeScope &&
    activeScope.expression === directoryExpression
      ? activeScope.folder
      : undefined;
  const selectingFolder = Boolean(subtreeQuery && !scopedFolder);

  function onQueryChange(value: string) {
    let previousScope: ReturnType<typeof parseSubtreeQuery> = null;
    let nextScope: ReturnType<typeof parseSubtreeQuery> = null;
    try {
      previousScope = parseSubtreeQuery(queryRef.current);
      nextScope = parseSubtreeQuery(value);
    } catch {
      // 在后面的搜索效果中统一显示无效语法。
    }
    if (nextScope && !previousScope) {
      // 在 Raycast 因搜索文本变化重新选中列表项前，保存当前高亮路径。
      setScopeHint({
        expression: nextScope.directoryExpression,
        selectedPath: selectedPathRef.current,
      });
    }
    if (nextScope?.directoryExpression !== previousScope?.directoryExpression) {
      setActiveScope(null);
      setDirectoryChoices([]);
      setChoicesTruncated(false);
    }
    queryRef.current = value;
    setQuery(value);
  }

  async function enterFolder(filepath: string) {
    try {
      const info = await stat(filepath);
      if (!info.isDirectory()) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Select a Folder",
          message: "Only an indexed directory can be used as the search scope.",
        });
        return;
      }
      let request: ReturnType<typeof parseSubtreeQuery> = null;
      try {
        request = parseSubtreeQuery(queryRef.current);
      } catch {
        // 当前表达式无效时，从真实的选中目录名称重新开始。
      }
      const expression =
        request?.directoryExpression ?? path.basename(filepath);
      const nextQuery = request ? queryRef.current : expression + "/ ";
      const folder = filepath === "/" ? "/" : filepath.replace(/\/+$/u, "");
      setActiveScope({ expression, folder });
      setDirectoryChoices([]);
      setScopeHint(null);
      queryRef.current = nextQuery;
      setQuery(nextQuery);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could Not Enter Folder",
        message: String(error),
      });
    }
  }

  function leaveFolder() {
    const expression = activeScope?.expression ?? "";
    setActiveScope(null);
    setScopeHint(null);
    selectedPathRef.current = null;
    queryRef.current = expression;
    setQuery(expression);
  }

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
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (!index || !subtreeQuery || scopedFolder || subtreeSyntaxError) {
      setIsLocatingDirectory(false);
      return () => controller.abort();
    }

    const expression = subtreeQuery.directoryExpression;
    const patterns = subtreeQuery.directoryPatterns;
    const hint =
      scopeHint?.expression === expression ? scopeHint.selectedPath : null;
    setScopeError(undefined);
    setDirectoryChoices([]);
    setChoicesTruncated(false);
    setIsLocatingDirectory(true);

    const resolve = async () => {
      // 用户先高亮某个目录、再输入 "/ " 或 "//"：优先锁定高亮目录。
      if (hint && matchesSelectedDirectory(hint, patterns)) {
        const selected = await stat(hint).catch(() => null);
        if (selected?.isDirectory()) {
          if (!controller.signal.aborted) {
            setActiveScope({
              expression,
              folder: hint === "/" ? "/" : hint.replace(/\/+$/u, ""),
            });
          }
          return;
        }
      }

      const choices = await findIndexedDirectoryChoices(
        indexFilePath(index),
        patterns,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (choices.paths.length === 1 && !choices.truncated) {
        setActiveScope({ expression, folder: choices.paths[0] });
      } else {
        setDirectoryChoices(choices.paths);
        setChoicesTruncated(choices.truncated);
      }
    };

    void resolve()
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setScopeError(String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLocatingDirectory(false);
      });
    return () => controller.abort();
  }, [
    index,
    directoryExpression,
    scopedFolder,
    subtreeSyntaxError,
    scopeHint?.expression,
    scopeHint?.selectedPath,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    const awaitingScope = subtreeQuery && !scopedFolder;

    if (
      !index ||
      subtreeSyntaxError ||
      awaitingScope ||
      (!query.trim() && !scopedFolder)
    ) {
      setResults([]);
      setIsSearching(false);
      return () => controller.abort();
    }

    setResults([]);
    setLoadError(undefined);
    setIsSearching(true);

    const timer = setTimeout(() => {
      const actualQuery = subtreeQuery ? subtreeQuery.nameQuery : query;
      fuzzySearch(index, actualQuery, controller.signal, scopedFolder)
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
  }, [index, query, scopedFolder, subtreeSyntaxError]);

  const activeError = subtreeSyntaxError ?? scopeError ?? loadError;
  const missingBinary = getMissingBinary(loadError);

  const emptyTitle = missingBinary
    ? "Missing Required Tool"
    : activeError
      ? "Search Error"
      : index === undefined
        ? "Loading Index"
        : !index
          ? "No Index Yet"
          : isLocatingDirectory
            ? "Finding Indexed Folders"
            : selectingFolder
              ? directoryChoices.length
                ? "Choose a Folder"
                : "No Matching Indexed Folders"
              : isSearching
                ? "Searching Index"
                : !query.trim()
                  ? "Type to Search"
                  : "No Matching Files";

  const emptyDescription = missingBinary
    ? missingBinaryMessage(missingBinary)
    : activeError
      ? activeError
      : !index
        ? "No index yet. Choose folders and build an index manually."
        : isLocatingDirectory
          ? "Finding real directory paths in the existing index (no fd scan)…"
          : selectingFolder
            ? directoryChoices.length
              ? "Select the intended folder to search its entire subtree."
              : "Try a more specific directory expression or select an indexed folder and press Tab."
            : isSearching
              ? "Searching " + index.count.toLocaleString() + " indexed paths…"
              : !query.trim()
                ? "Indexed " +
                  index.count.toLocaleString() +
                  " paths on " +
                  new Date(index.createdAt).toLocaleString() +
                  "."
                : "Try a different pattern or rebuild the index to include new files.";

  return (
    <List
      isLoading={index === undefined || isSearching || isLocatingDirectory}
      filtering={false}
      searchText={query}
      searchBarPlaceholder={
        scopedFolder
          ? "Within " + scopedFolder + " — search any descendant name"
          : "Search name, dir/file, or dir/ term (subtree)"
      }
      navigationTitle={
        scopedFolder
          ? "Search Within " + scopedFolder
          : selectingFolder
            ? "Choose Indexed Folder" +
              (choicesTruncated ? " (refine query)" : "")
            : undefined
      }
      onSearchTextChange={onQueryChange}
      onSelectionChange={(id) => {
        selectedPathRef.current = id || null;
      }}
    >
      <List.EmptyView
        title={emptyTitle}
        description={emptyDescription}
        icon={Icon.MagnifyingGlass}
        actions={
          <ActionPanel>
            {!subtreeQuery && (
              <SearchAssistanceActions
                index={index}
                query={query}
                onApply={onQueryChange}
              />
            )}
            {!index && index !== undefined && (
              <Action
                title="Choose Folders and Build Index"
                icon={Icon.Folder}
                onAction={() =>
                  launchCommand({
                    name: "rebuild-index",
                    type: LaunchType.UserInitiated,
                  })
                }
              />
            )}
            {(!index || missingBinary) && (
              <>
                <Action.CopyToClipboard
                  title="Copy fd/fzf Install Command"
                  icon={Icon.CopyClipboard}
                  content={HOMEBREW_INSTALL_COMMAND}
                />
                <Action.OpenInBrowser
                  title="How to Install Homebrew"
                  url={HOMEBREW_URL}
                />
              </>
            )}
            {!index && index !== undefined && (
              <Action
                title="View Index Status"
                icon={Icon.Info}
                onAction={() =>
                  launchCommand({
                    name: "index-status",
                    type: LaunchType.UserInitiated,
                  })
                }
              />
            )}
          </ActionPanel>
        }
      />
      {selectingFolder &&
        !isLocatingDirectory &&
        directoryChoices.map((folder) => (
          <List.Item
            key={"directory:" + folder}
            id={"directory:" + folder}
            title={path.basename(folder)}
            subtitle={
              (folder.startsWith(os.homedir() + path.sep)
                ? "~" + folder.slice(os.homedir().length)
                : folder) +
              (choicesTruncated ? " · More matches: refine path" : "")
            }
            icon={Icon.Folder}
            actions={
              <ActionPanel>
                <Action
                  title="Search Within This Folder"
                  icon={Icon.Folder}
                  shortcut={{ modifiers: [], key: "tab" }}
                  onAction={() => void enterFolder(folder)}
                />
                <Action.CopyToClipboard
                  title="Copy Folder Path"
                  content={folder}
                />
              </ActionPanel>
            }
          />
        ))}
      {!selectingFolder &&
        results.map((filepath) => {
          const display = filepath.startsWith(os.homedir() + path.sep)
            ? "~" + filepath.slice(os.homedir().length)
            : filepath;
          return (
            <List.Item
              key={filepath}
              id={filepath}
              title={path.basename(filepath)}
              subtitle={path.dirname(display)}
              icon={{ fileIcon: filepath }}
              quickLook={{ path: filepath, name: path.basename(filepath) }}
              actions={
                <ActionPanel>
                  {dialogMode && (
                    <ActionPanel.Section title="Assisted Open/Save Navigation">
                      <Action.Paste
                        title="Select File or Go to Folder (Paste Full Path)"
                        icon={Icon.ArrowRight}
                        content={
                          getDialogNavigationPaths(filepath).selectedPath
                        }
                      />
                      <Action.Paste
                        title="Go to Containing Folder (Fallback)"
                        icon={Icon.Folder}
                        content={
                          getDialogNavigationPaths(filepath).containingFolder
                        }
                      />
                    </ActionPanel.Section>
                  )}
                  <ActionPanel.Section title="Other File Actions">
                    <Action.Open title="Open" target={filepath} />
                    <Action
                      title="Search Within This Folder"
                      icon={Icon.Folder}
                      shortcut={{ modifiers: [], key: "tab" }}
                      onAction={() => void enterFolder(filepath)}
                    />
                    {scopedFolder && (
                      <Action
                        title="Leave Folder Scope"
                        icon={Icon.ArrowLeft}
                        onAction={leaveFolder}
                      />
                    )}
                    <Action.ShowInFinder
                      title="Show in Finder"
                      path={filepath}
                    />
                    <Action.Open
                      title="Open Containing Folder"
                      target={path.dirname(filepath)}
                    />
                    <Action.OpenWith
                      path={filepath}
                      shortcut={{ modifiers: ["cmd"], key: "o" }}
                    />
                    <Action.CopyToClipboard
                      title="Copy Absolute Path"
                      content={filepath}
                      shortcut={{ modifiers: ["cmd"], key: "c" }}
                    />
                    <Action.ToggleQuickLook
                      shortcut={{ modifiers: ["cmd"], key: "y" }}
                    />
                  </ActionPanel.Section>
                  <SearchAssistanceActions
                    index={index}
                    query={query}
                    onApply={onQueryChange}
                  />
                </ActionPanel>
              }
            />
          );
        })}
    </List>
  );
}

/** Default Search Files keeps its existing file-open behavior. */
export default function SearchFiles() {
  return <SearchFilesView />;
}
